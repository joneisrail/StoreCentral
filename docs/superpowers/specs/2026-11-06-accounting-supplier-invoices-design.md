# Accounting: Supplier Invoices — Design

First piece of the accounting module. Builds on
`2026-11-06-supplier-and-purchase-modules-design.md` and
`2026-11-06-supplier-enhancements-design.md`. Same layering (module ->
workflow -> admin route -> admin page) and conventions.

## Purpose

Let an admin record the invoices suppliers send, tie each one to the purchase
it bills, and see at a glance whether the bill matches what was ordered and
what arrived. Suppliers call the same product by different names, so invoice
lines are entered by the supplier's own code and matched to our products
through the supplier's Products list.

**Intended outcome:** the admin opens an invoice from a supplier, picks the
purchase, enters or confirms the lines by supplier code, and sees per item the
ordered, received and invoiced quantities and costs, with warnings for price
differences and over-billing. Posting the invoice locks it and makes it count
as billed, which the later payments piece will use.

**Explicitly out of scope:**
- Payments to suppliers and balances owed (the next piece).
- Sales, revenue and profit (later pieces).
- Any change to stock. Only Receive goods raises stock. An invoice never
  does.
- Scanning or importing invoice files, attachments, credit notes, and
  currencies other than USD.
- One invoice covering several purchases, or an invoice with no purchase.

## Decisions carried from brainstorming

- Accounting is built in pieces: 1 supplier invoices, 2 supplier payments,
  3 sales and revenue, 4 profit. This is piece 1. (Agreed.)
- An invoice only records the bill; stock still changes only through Receive
  goods. (Chosen: recommended option.)
- One invoice belongs to exactly one purchase; a purchase may have several
  invoices. (Chosen: recommended option, plus several invoices per purchase.)
- A code that is not on the supplier's list is resolved by picking one of our
  products, with an option to remember the code on the supplier's list.
  (Chosen: recommended option.)
- Everything is in USD, entered by hand. (Assumption, consistent with the
  rest of the system.)

## Architecture

```
apps/backend/src/
  modules/accounting/       index.ts, service.ts, models/, migrations/, utils.ts
  links/                    invoice-purchase.ts
                            invoice-item-variant.ts
  workflows/                create-invoice, update-invoice, post-invoice,
                            void-invoice (+ steps/)
  api/admin/invoices/       route.ts, [id]/route.ts, [id]/post/route.ts,
                            [id]/void/route.ts, middlewares.ts, map-invoice.ts,
                            compare-invoice.ts
  admin/routes/accounting/invoices/   list page, new page, [id] detail page
```

The module is registered in `apps/backend/medusa-config.ts` as `accounting`
(camelCase). Migrations are generated with `npx medusa db:generate accounting`,
never hand-written. The accounting module does not import the purchase or
supplier services; it connects through module links and reads other modules
with `query.graph`. Only a route or workflow step may read across modules.

### Data model

| Model | Fields |
|---|---|
| Invoice | `id`, `display_id` (autoincrement; shown as `INV-0001`), `supplier_id`, `purchase_id` (plain columns, also used for duplicate checks), `invoice_number` (the supplier's own number, required, trimmed), `invoice_number_key` (lower-cased trimmed copy), `status` (`draft`, `posted`, `void`), `invoice_date`, `due_date` (optional), `shipping_cost`, `tax`, `other_cost` (each default 0), `notes`, `posted_at`, `voided_at`, `currency_code` (fixed `usd`) |
| InvoiceItem | `id`, `invoice`, `purchase_item_id` (nullable; null means not on the purchase), `variant_id`, `supplier_sku`, `description` (snapshots), `quantity` (integer > 0), `unit_cost` |

Amounts are plain dollars (`model.bigNumber()`), never cents. Not stored,
computed on read: subtotal (sum of `quantity * unit_cost`) and total (subtotal
+ `shipping_cost` + `tax` + `other_cost`), rounded to 2 decimals like the
purchase totals. The reference `INV-` plus the number zero-padded to 4 digits
is derived from `display_id`.

Unique: (`supplier_id`, `invoice_number_key`) among rows that are not void and
not soft-deleted (a partial unique index, `WHERE status <> 'void' AND
deleted_at IS NULL`, if the DML supports a predicate; otherwise the workflow
checks inside a lock and the review focus below applies).

### Links

- Invoice to Purchase: one purchase per invoice, many invoices per purchase.
- InvoiceItem to Product Variant: `variant_id`.

### Status rules

```
draft -> posted -> void
draft -> void
```

- Header and lines are editable only in `draft`.
- `post` needs at least one line and a purchase that is not `cancelled` or
  `draft`. A posted invoice is locked and counts as billed.
- `void` is allowed from `draft` or `posted` and keeps the record. A voided
  invoice no longer counts as billed and frees its invoice number.
- Piece 2 (payments) will refuse to void an invoice that has payments.

### Line entry and matching

A line is created from one of:
- `supplier_sku` alone: resolved through the supplier's Products list
  (case-insensitive, trimmed) to a `variant_id`; 400 if the code is not on
  the list.
- `variant_id` (the admin picked one of our products), optionally with
  `remember_code: true` and a `supplier_sku`: adds the entry to the
  supplier's Products list using the existing create-supplier-product
  workflow, in the same transaction as creating the invoice (a failure rolls
  both back). If the code or the variant is already on the list for that
  supplier, the request is rejected with the existing message.

After resolving the variant, the line is linked to the purchase item with the
same variant. If the purchase has two items for that variant, the request must
name `purchase_item_id`. If no purchase item has that variant, the line is
saved with `purchase_item_id = null` and shown as "Not on purchase".

### Comparison (computed on read, per invoice)

For each purchase item plus each unmatched invoice line:
`ordered_quantity`, `received_quantity` (`quantity_received`),
`invoiced_quantity` (this invoice), `invoiced_quantity_total` (all posted
invoices for the purchase plus this one when draft), `ordered_unit_cost`,
`invoiced_unit_cost`, and flags:
- `price_difference`: invoiced unit cost differs from the ordered cost.
- `over_received`: `invoiced_quantity_total` is greater than
  `received_quantity`.
- `over_ordered`: `invoiced_quantity_total` is greater than `ordered_quantity`.
- `not_on_purchase`: no purchase item.
Header level: `purchase_total` and `invoice_total` and their difference.
Flags are warnings only; they never block saving or posting.

## API contract

All routes are admin-only (auth is automatic under `/admin/*`). Zod is
imported from `@medusajs/framework/zod`; each schema's inferred type is
exported. Only GET and POST are used.

| Method and path | Purpose |
|---|---|
| `GET /admin/invoices` | List (paginated; filters `purchase_id`, `supplier_id`, `status`; `q` searches invoice number, case-insensitive, `%` and `_` literal) |
| `POST /admin/invoices` | Create a draft: `purchase_id`, `invoice_number`, `invoice_date`, optional `due_date`, costs, notes, `items[]` |
| `GET /admin/invoices/:id` | One invoice with items, supplier, purchase reference, totals, comparison |
| `POST /admin/invoices/:id` | Update a draft (header and/or full replacement of `items`) |
| `POST /admin/invoices/:id/post` | Post |
| `POST /admin/invoices/:id/void` | Void |

Errors use `MedusaError` with clear messages: duplicate invoice number names
the supplier and number; a code not on the supplier's list names the code;
editing a posted invoice says it is locked.

## UI

- **Accounting** top-level sidebar item with **Invoices** as a sub-item
  (pages under `/accounting/invoices`, using the path-nesting the sidebar
  already supports). The accounting parent page redirects to Invoices.
- **Invoices list:** reference, supplier, supplier invoice number, purchase
  reference, date, total, status badge; status filter; search; pagination.
- **New invoice:** choose a purchase (search by reference or supplier), enter
  the supplier's invoice number, date, optional due date and costs. Lines are
  prefilled from the purchase's items with the quantity still uninvoiced and
  the ordered cost; the admin edits quantities and costs, removes lines, or
  adds a line by typing the supplier's code (with the "pick a product and
  remember this code" step for unknown codes). Live totals and comparison
  warnings show before saving.
- **Invoice detail:** header, lines, comparison table with warning badges,
  totals, Post and Void buttons (only when allowed), edit for drafts.
- **Purchase detail:** a "Record invoice" button (opens New invoice with the
  purchase preselected) and a list of that purchase's invoices.
- All requests use `sdk.client.fetch`. Mutations show success and error
  toasts. Lists clamp pagination when the count shrinks.

## Testing

- **Unit:** totals and rounding; reference formatting; comparison flags
  (price difference, over received, over ordered, not on purchase, duplicate
  variant on the purchase); invoice-number normalization.
- **Module integration:** models, the duplicate-number rule, and that a void
  invoice frees its number.
- **HTTP integration:** each route; duplicate number (including a concurrent
  pair: exactly one succeeds); editing a posted or void invoice is refused;
  post with no lines refused; post against a cancelled or draft purchase
  refused; code resolution by supplier list; unknown code refused; remember-
  code adds the supplier entry and a failure rolls the invoice back; ambiguous
  variant needs `purchase_item_id`; not-on-purchase lines saved and flagged;
  comparison numbers; stock levels unchanged by create, post and void.
- **Admin pages:** component tests in the existing style for the list, new
  invoice (prefill, add by code, unknown-code flow) and detail pages.
- **Before finishing:** build, lint, every test added, migration applied to
  the dev database.

## Open assumptions to confirm

- The sidebar item is named **Accounting** with **Invoices** under it.
- Invoice date is required; due date is optional.
- Warnings never block posting.

## Review Focus

- Two simultaneous invoices with the same supplier number: exactly one wins.
- Posting an invoice twice, or voiding while another request posts it.
- A purchase item whose variant was removed from the catalog: lines and
  comparison still render.
- Remember-code failure after the invoice was created: nothing is left behind.
- Invoice totals match the purchase module's rounding for the same figures.
