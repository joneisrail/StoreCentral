# Supplier and Purchase Modules (Backend + Admin) — Design

## Purpose

Let admin users record the products they buy from suppliers to resell, and
raise Medusa stock when goods arrive. Purchases are received in parts: each
delivery is recorded, adds stock when received, and the purchase stays open
until everything ordered has arrived.

**Intended outcome:** an admin keeps a list of suppliers, creates a purchase
(a draft with items, unit costs and extra costs), places the order, and later
records each delivery against a stock location. Each delivery raises the
inventory level at that location and updates how much of each item has
arrived. The cost per unit and the extra costs are kept so profit can be
worked out in a later piece.

**Explicitly out of scope:**
- Profit, sales or accounting reports. The cost data is stored so a later
  piece can use it, but nothing here reads orders or computes profit.
- Tracking payments made to suppliers (paid / part paid / unpaid).
- More than one currency. Every purchase is in USD; there is no conversion.
- Spreading extra costs (shipping, tax, other) across items to get a per-unit
  landed cost.
- Any storefront or customer-facing endpoint. Everything is admin-only.
- Receiving more than the ordered quantity.
- Supplier price lists, expected delivery dates, or attachments.

## Decisions carried from brainstorming

- **Purpose:** buy products from suppliers to resell; stock goes up when goods
  arrive. (Said by the user.)
- **Partial receiving:** deliveries come in parts and can be short. Recorded
  per delivery; the purchase stays open until complete. (Chosen.)
- **Supplier records:** suppliers are reusable records, not free text on each
  purchase. (Chosen.)
- **Costs:** per-item unit cost plus shipping, tax and other costs on the
  whole purchase. No payment tracking. (Chosen: items + extra costs.)
- **Currency:** one currency for everything, assumed USD like the store.
  (Chosen: one currency; USD is an assumption to confirm.)
- **Structure:** two modules, `supplier` and `purchase`, linked through
  Medusa module links. (Chosen after an initial single-module proposal.)
- **Over-delivery:** blocked. A delivery cannot take an item above its
  ordered quantity; the admin raises the ordered quantity first. (Chosen.)

## Architecture

Follows the same layering as the existing `review` module and its workflows:

```
Module (data models + CRUD)
  -> Workflow (business rules + mutations, with rollback)
  -> Admin API route (validation middleware, calls the workflow)
  -> Admin dashboard page (Medusa JS SDK)
```

Medusa modules are isolated, so no module reads another's tables directly.
Connections go through module links.

```
apps/backend/src/
  modules/supplier/          index.ts, service.ts, models/, migrations/
  modules/purchase/          index.ts, service.ts, models/, migrations/
  links/                     purchase-supplier.ts
                             purchase-item-variant.ts
                             purchase-receipt-stock-location.ts
  workflows/                 create-supplier, update-supplier, delete-supplier,
                             create-purchase, update-purchase, place-purchase-order,
                             receive-purchase-goods, cancel-purchase  (+ steps/)
  api/admin/suppliers/       route.ts, [id]/route.ts, middlewares.ts
  api/admin/purchases/       route.ts, [id]/route.ts, [id]/order/route.ts,
                             [id]/receive/route.ts, [id]/cancel/route.ts,
                             middlewares.ts
  admin/routes/suppliers/    list page, create/edit form
  admin/routes/purchases/    list page, detail page, new-purchase page,
                             receive-goods dialog
```

Both modules are registered in `apps/backend/medusa-config.ts`. Migrations are
generated with the module's `migration:create` script, never written by hand.
Module names are camelCase (`supplier`, `purchase`).

### Data model

**`supplier` module**

| Model | Fields |
|---|---|
| Supplier | `id`, `name` (required), `email`, `phone`, `address`, `notes` |

**`purchase` module**

| Model | Fields |
|---|---|
| Purchase | `id`, `display_id` (autoincrement; shown as the reference `PO-0001`), `status` (`draft`, `ordered`, `partially_received`, `received`, `cancelled`), `currency_code` (fixed `usd`), `shipping_cost`, `tax`, `other_cost` (each default 0), `notes`, `ordered_at` |
| PurchaseItem | `id`, `purchase`, `variant_id`, `sku` and `title` (snapshots), `quantity` (ordered), `quantity_received` (default 0), `unit_cost` |
| PurchaseReceipt | `id`, `purchase`, `stock_location_id`, `received_at`, `note` |
| PurchaseReceiptItem | `id`, `receipt`, `purchase_item`, `quantity` |

Amounts are plain dollar values (12.50 is stored as 12.50), never cents, as
with Medusa prices. Not stored, computed on read: items subtotal (sum of
`quantity * unit_cost`) and purchase total (subtotal + `shipping_cost` + `tax`
+ `other_cost`). The purchase reference is derived on read from the autoincrement `display_id`
(`PO-` plus the number zero-padded to 4 digits), so two simultaneous purchases
never share one and no separate column is needed. Money columns use Medusa's
`bigNumber` type.

### Module links

- Purchase to Supplier: one supplier per purchase, many purchases per supplier.
- PurchaseItem to Product Variant: `variant_id`.
- PurchaseReceipt to Stock Location: `stock_location_id`.

Links are defined under `src/links/` and synced with a migration.

### Status rules

```
draft -> ordered -> partially_received -> received
  \         \
   \         -> cancelled   (only while nothing has been received)
    -> cancelled
```

- Items and costs are editable only in `draft`.
- Goods can be received only in `ordered` or `partially_received`.
- After a delivery: `partially_received` if any item still has remaining
  quantity, `received` if every item's `quantity_received` equals `quantity`.
- A purchase with any received quantity cannot be cancelled.
- A supplier that has purchases cannot be deleted.

### Workflows

All mutations go through workflows; routes only validate and call them. Steps
have compensation, so a failure undoes the earlier steps.

- **`create-supplier`, `update-supplier`, `delete-supplier`.** Delete is
  refused when the supplier has any linked purchase.
- **`create-purchase`.** Creates a `draft` with items, linked to the supplier
  and variants. Validates that the supplier and every variant exist,
  quantities are integers above 0, and costs are 0 or more.
- **`update-purchase`.** Edits items and costs; only in `draft`.
- **`place-purchase-order`.** `draft` to `ordered`, sets `ordered_at`. Needs
  at least one item.
- **`receive-purchase-goods`.** Input: stock location and, per purchase item,
  the quantity that arrived. Steps:
  1. Validate: status is `ordered` or `partially_received`; each received
     quantity is an integer above 0 and does not exceed the item's remaining
     quantity (`quantity - quantity_received`); each variant has managed
     inventory and an inventory item.
  2. Create the receipt and its items.
  3. Raise stock: increase the inventory level at the stock location for each
     variant's inventory item by the received quantity. If no level exists for
     that location, create one.
  4. Update each item's `quantity_received`.
  5. Set the purchase status from the rules above.

  Compensation reverses the stock change and removes the receipt if a later
  step fails, so inventory and purchase records never disagree.
- **`cancel-purchase`.** Sets `cancelled`; only when nothing has been received.

Errors use `MedusaError` with clear messages (for example over-receiving names
the item and the remaining quantity).

## API contract

All routes are admin-only and use `authenticate` middleware. Medusa allows only
GET, POST and DELETE, so updates are POSTs.

| Method and path | Purpose |
|---|---|
| `GET /admin/suppliers` | List suppliers (paginated, search by name) |
| `POST /admin/suppliers` | Create a supplier |
| `GET /admin/suppliers/:id` | One supplier |
| `POST /admin/suppliers/:id` | Update a supplier |
| `DELETE /admin/suppliers/:id` | Delete (refused if it has purchases) |
| `GET /admin/purchases` | List (paginated, filter by `status` and `supplier_id`) |
| `POST /admin/purchases` | Create a draft purchase |
| `GET /admin/purchases/:id` | One purchase with items, receipts, supplier, totals |
| `POST /admin/purchases/:id` | Update a draft purchase |
| `POST /admin/purchases/:id/order` | Place the order |
| `POST /admin/purchases/:id/receive` | Record a delivery |
| `POST /admin/purchases/:id/cancel` | Cancel |

Request bodies are validated with Zod (imported from `@medusajs/framework/zod`),
with the inferred type exported alongside each schema. Responses include the
computed `subtotal` and `total`.

## UI

New sidebar pages, in the same style as the existing Reviews and Fulfillment
Queue pages (Medusa admin extensions under `apps/backend/src/admin/routes/`):

- **Suppliers:** list with search; a form to create or edit; delete with a
  confirmation and a clear message when refused.
- **Purchases list:** reference, supplier, status, total, order date; status
  filter; pagination.
- **Purchase detail:** items (ordered, received, unit cost), costs and
  totals, delivery history. Buttons: Place order (draft), Receive goods
  (ordered or partly received), Cancel (nothing received).
- **Receive goods dialog:** choose the stock location; enter the quantity
  arrived for each item. Shows the remaining quantity and blocks values above
  it.
- **New purchase:** choose a supplier, add items by searching variants with a
  quantity and unit cost, enter shipping, tax and other costs, save as draft.

All requests use the Medusa JS SDK (`sdk.client.fetch`), never raw `fetch`.
Mutations show success or error feedback. Admin UI follows the
`building-admin-dashboard-customizations` conventions.

## Testing

- **Unit:** subtotal and total calculation; remaining quantity; status after a
  delivery (partial and complete); reference formatting.
- **Module integration (real database):** both modules' models and services.
- **HTTP integration:** each route, including: a failed receive leaves stock
  and purchase records unchanged; over-receiving is blocked; a supplier with
  purchases cannot be deleted; a purchase with received goods cannot be
  cancelled; items cannot be edited outside `draft`; a variant without managed
  inventory is rejected on receive; a missing inventory level is created.
- **Admin pages:** component tests in the same style as the Reviews page.
- **Before finishing:** full backend build, lint, and every test file added.

## Open assumptions to confirm

- Currency is USD for every purchase.
- The purchase `reference` format is `PO-` followed by a zero-padded number.
- Receiving needs a stock location chosen each time (no per-purchase default).

## Review Focus

- The receive workflow's compensation: a failure after the stock increase must
  restore the previous inventory level.
- Concurrent receives on one purchase: remaining-quantity checks must not let
  two simultaneous deliveries exceed the ordered quantity.
- Module isolation: neither module imports the other's service; only links
  connect them.
