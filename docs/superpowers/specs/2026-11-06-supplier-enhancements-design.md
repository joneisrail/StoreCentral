# Supplier Enhancements — Design

Builds on `2026-11-06-supplier-and-purchase-modules-design.md`. Same layering
(module -> workflow -> admin route -> admin page), same conventions.

## Purpose

Make the supplier module useful day to day: richer supplier records, a way to
retire a supplier without losing history, a view of what has been bought from
them, and a per-supplier product list that maps the supplier's own product
code and name to our existing product variants.

**Intended outcome:** when a supplier invoice arrives, the admin types the
supplier's code or name and lands on our own product, because every supplier
calls the same product something different. New purchases prefill the usual
cost from that list.

**Explicitly out of scope:**
- Payments to suppliers. These belong to a later accounting module that works
  from invoices. Nothing here records paid / unpaid.
- Creating or editing products. The supplier product list only links variants
  that already exist.
- Several codes for one supplier and variant (one record per pair).
- Changing existing purchases or how receiving works.

## Decisions carried from brainstorming

- Scope: more supplier details, active/inactive, purchase history, supplier
  product list. Payments dropped. (User.)
- Supplier product list links existing variants only and stores the supplier's
  own product id (code) with ours, so invoice lines can be matched. (User.)
- One record per supplier and variant; a supplier code points to exactly one
  variant for that supplier. (Chosen.)
- "Outstanding" means goods ordered but not yet received, because there are no
  payments. (Assumption, confirmed by silence on the alternative.)

## Data model

**Supplier** gains: `contact_name`, `website`, `tax_id`, `payment_terms` (free
text, e.g. "Net 30"), `lead_time_days` (integer, 0 or more), all optional; and
`is_active` (boolean, default true). Existing rows become active with the new
fields empty. Migration generated with `npx medusa db:generate supplier`.

**SupplierProduct** (new model in the `supplier` module):

| Field | Notes |
|---|---|
| `id` | |
| `supplier` | belongs to Supplier |
| `variant_id` | our product variant (linked, see below) |
| `supplier_sku` | supplier's own code, required |
| `supplier_title` | supplier's name for it, optional |
| `unit_cost` | usual cost, `bigNumber`, plain dollars, optional |
| `notes` | optional |

Unique: (`supplier`, `variant_id`) and (`supplier`, `supplier_sku`), both
ignoring soft-deleted rows. Codes are compared case-insensitively and trimmed;
they are stored trimmed.

**Link:** `SupplierProduct` to Product Variant in `src/links/`. The supplier
module never reads product tables and never creates products.

Purchases are unchanged. Purchase history uses the existing purchase-to-supplier
link.

## Behavior

**Active/inactive**
- `POST /admin/suppliers/:id` accepts `is_active`.
- `GET /admin/suppliers` accepts `is_active` (`true` / `false`); omitted lists
  all. The New purchase supplier picker requests only active suppliers.
- `create-purchase` rejects an inactive supplier with a 400. Existing
  purchases are untouched, including receiving and cancelling.
- Delete is unchanged: refused when the supplier has any purchase.

**Supplier products** (all admin-only, mutations through workflows with
compensation)
- `GET /admin/suppliers/:id/products`: paginated; `q` searches supplier code,
  supplier title, and our product title / variant title / SKU (LIKE wildcards
  `%` and `_` in `q` are escaped). Each row includes the variant, its product
  title and SKU.
- `POST /admin/suppliers/:id/products`: links a variant. Body: `variant_id`,
  `supplier_sku`; optional `supplier_title`, `unit_cost` (>= 0), `notes`.
  400 if the variant does not exist, the variant is already on this supplier's
  list, or the code is already used by this supplier. The messages name which.
- `POST /admin/suppliers/:id/products/:product_id`: edit code, title, cost,
  notes. The variant cannot be changed (unlink and add instead). Same
  uniqueness rules.
- `DELETE /admin/suppliers/:id/products/:product_id`: removes the entry and its
  link only. The product and variant are untouched.
- Suppliers may be inactive and still have their list edited.

**Cost prefill:** on the New purchase page, adding a variant that is on the
chosen supplier's list prefills the unit cost from `unit_cost` (when set) and
shows the supplier's code beside our title. The admin can change it. Purchase
items still snapshot the cost they were created with, so editing a supplier's
usual cost never changes existing purchases. Changing the supplier after items
are added does not rewrite their costs.

**Purchase history:** `GET /admin/suppliers/:id/summary` returns:
- `counts` by status;
- `total_ordered`: sum of totals (items + shipping + tax + other) of purchases
  that are not draft or cancelled;
- `total_received`: sum over items of `quantity_received * unit_cost` for the
  same purchases;
- `outstanding`: sum over items of `(quantity - quantity_received) * unit_cost`
  for the same purchases (goods still awaited). Shipping, tax and other costs
  are not part of `outstanding`.
All amounts are plain dollars. Draft purchases are excluded because nothing
has been ordered yet. Calculation lives in a pure function in the purchase
module's `utils.ts` style and is unit tested; the route reads purchases through
`query.graph` via the existing link, not by importing the purchase service from
the supplier module.

## Admin pages

- **Suppliers list:** Active / Inactive / All filter and an inactive badge.
- **Supplier detail page** (new; the row links to it) with three tabs:
  - *Details:* the new fields, an active switch, save.
  - *Products:* the linked list with search, an "Add product" dialog that
    searches our variants and takes supplier code / name / cost, edit, unlink
    with confirmation.
  - *Purchases:* summary cards (counts, ordered, received, outstanding) and the
    supplier's purchases with links to each.
- All requests use `sdk.client.fetch`. Mutations show success and error toasts.

## Testing

- **Unit:** summary calculations (mixed statuses, partial receipts, cancelled
  and draft excluded, zero purchases); code normalization.
- **Module integration:** both uniqueness rules, case-insensitive code match,
  soft-delete does not block re-adding.
- **HTTP integration:** each new route; inactive supplier blocks create-purchase
  but not receive; duplicate code and duplicate variant; unknown variant;
  unlink leaves the variant; search by supplier code, supplier title and our
  SKU; wildcard characters in `q` match literally; summary numbers.
- **Admin pages:** component tests in the existing style for the detail tabs,
  add dialog and cost prefill.
- **Before finishing:** build, lint, every test file added, and the migration
  applied to the dev database.

## Review Focus

- Uniqueness races: two simultaneous adds of the same code must not both
  succeed (database unique indexes, not only a pre-check).
- Existing data: migrating suppliers that already exist, and purchases whose
  supplier is later deactivated.
- A variant deleted from the catalog while linked: list rows must still render.
- Search input with `%`, `_` or empty text.
