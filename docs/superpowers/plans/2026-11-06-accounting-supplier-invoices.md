# Accounting: Supplier Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record supplier invoices against purchases, match their lines to our products through the supplier's code list, compare billed against ordered and received, and lock them by posting.

**Architecture:** A new `accounting` module (Invoice, InvoiceItem) linked to Purchase and Product Variant; workflows for create / update / post / void; admin routes under `/admin/invoices`; admin pages under a new top-level Accounting menu item; a "Record invoice" entry on the purchase page. Other modules are read through `query.graph` and links only.

**Tech Stack:** Medusa v2 (DML, `MedusaService`, workflows, `query.graph`, links, locking module), Zod from `@medusajs/framework/zod`, Medusa admin extensions (React, `@medusajs/ui`, `sdk.client.fetch`), jest, `medusaIntegrationTestRunner`, `moduleIntegrationTestRunner`.

**Spec:** `docs/superpowers/specs/2026-11-06-accounting-supplier-invoices-design.md`

## Global Constraints

Paths are relative to `apps/backend/`; run commands from there.

- Zod only from `@medusajs/framework/zod`. Only GET and POST routes. Every mutation goes through a workflow with compensation. Errors are `MedusaError`.
- Migrations are generated with `npx medusa db:generate accounting`, never hand-written. Module name `accounting` (camelCase), registered in `medusa-config.ts` next to `supplier` and `purchase`.
- Money is plain dollars (`model.bigNumber()`), serialized as `number`; totals rounded to 2 decimals with the same rounding as `calculatePurchaseTotals` in `src/modules/purchase/utils.ts`.
- The accounting module must not import the purchase or supplier modules' services; it reads them through `query.graph` and links. A workflow step may call other modules' workflows (remember-code).
- Invoices never change stock; no step in this plan touches inventory.
- Admin pages use `sdk.client.fetch` / `sdk.admin.*` only, show toasts for mutation results, clamp pagination when the count shrinks, and follow the supplier and purchase pages. Lists show a retryable error state.
- Payments, sales and profit are out of scope.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Branch `feat/accounting-invoices`.
- Test commands: `yarn test:unit <path>`, `yarn test:integration:modules <path>`, `yarn test:integration:http <path>`. Do not run `npx medusa db:migrate` against the dev database except in Task 9, and never touch the dev server on port 9000.

## Review Focus

- Two simultaneous invoices with the same supplier number: exactly one wins (Task 2 test).
- Posting twice, or voiding while another request posts (Task 5 test).
- A purchase item whose variant left the catalog: the comparison still renders (Task 3 test).
- Remember-code followed by a failure: no supplier entry and no invoice remain (Task 2 test).
- Totals match the purchase module's rounding for the same figures (Task 1 test).

---

### Task 1: Accounting module, models, utilities

**Files:**
- Create: `src/modules/accounting/index.ts`, `service.ts`, `models/invoice.ts`, `models/invoice-item.ts`, `utils.ts`, generated migration under `src/modules/accounting/migrations/`
- Modify: `medusa-config.ts`
- Test: `src/modules/accounting/__tests__/accounting-utils.unit.spec.ts`, `src/modules/accounting/__tests__/accounting-module-service.spec.ts`

**Interfaces:**
- Produces `ACCOUNTING_MODULE = "accounting"` and `AccountingModuleService` with `createInvoices`, `listInvoices`, `retrieveInvoice`, `updateInvoices`, `deleteInvoices`, `createInvoiceItems`, `listInvoiceItems`, `deleteInvoiceItems`.
- Produces in `utils.ts`: `formatInvoiceReference(displayId: number): string` (`INV-0001`); `normalizeInvoiceNumber(raw: string): { invoice_number: string; invoice_number_key: string }` (trim; key lower-cased; empty throws `MedusaError` INVALID_DATA "Invoice number is required"); `calculateInvoiceTotals(items: {quantity:number; unit_cost:number}[], extra: {shipping_cost:number; tax:number; other_cost:number}): { subtotal: number; total: number }`; `invoiceLockKey(supplierId: string, invoiceNumberKey: string): string` returning `"invoice-number:" + supplierId + ":" + invoiceNumberKey`; `invoiceStatusLockKey(invoiceId: string): string` returning `"invoice:" + invoiceId`.
- Models: Invoice (`id`, `display_id` autoincrement, `supplier_id`, `purchase_id`, `invoice_number`, `invoice_number_key`, `status` enum draft|posted|void default draft, `invoice_date` dateTime, `due_date` nullable dateTime, `shipping_cost`/`tax`/`other_cost` bigNumber default 0, `notes` nullable, `posted_at`/`voided_at` nullable dateTime, `currency_code` default "usd", `items` hasMany); InvoiceItem (`id`, `invoice` belongsTo, `purchase_item_id` nullable text, `variant_id`, `supplier_sku`, `description`, `quantity` number, `unit_cost` bigNumber). Partial unique index on (`supplier_id`, `invoice_number_key`) with a `where` predicate excluding void rows (soft-deleted rows are excluded by Medusa automatically); if the DML `where` option does not exist in the installed version, stop and report instead of improvising.

- [ ] **Step 1: Write the failing tests.**
  - Unit: `formatInvoiceReference(7)` is `"INV-0007"`; `normalizeInvoiceNumber("  Ab-1 ")` is `{ invoice_number: "Ab-1", invoice_number_key: "ab-1" }`; blank throws; `calculateInvoiceTotals([{quantity:3, unit_cost:0.1}], {shipping_cost:0, tax:0, other_cost:0})` is `{ subtotal: 0.3, total: 0.3 }` and equals `calculatePurchaseTotals` for the same inputs (import it in the test for the comparison); lock keys are exactly the strings above.
  - Module: defaults (`status` draft, costs 0, `currency_code` usd); two invoices with the same supplier and key reject; the same key for a different supplier is allowed; a `void` invoice frees its key (create, set status void, create again succeeds); a posted invoice keeps blocking.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/modules/accounting`, `yarn test:integration:modules src/modules/accounting`.
- [ ] **Step 3: Implement** models, service, utils, register in `medusa-config.ts`, then `npx medusa db:generate accounting`.
- [ ] **Step 4: Run Step 2 commands, expect PASS;** `npx tsc --noEmit -p .` and `yarn lint` clean.
- [ ] **Step 5: Commit** — `feat(backend): add accounting module with invoice models`.

---

### Task 2: Create invoice (links, line resolution, remember code, duplicate guard)

**Files:**
- Create: `src/links/invoice-purchase.ts`, `src/links/invoice-item-variant.ts`, `src/workflows/create-invoice.ts`, steps `src/workflows/steps/resolve-invoice-lines.ts`, `create-invoice.ts`, `remember-supplier-codes.ts`, `src/api/admin/invoices/route.ts` (POST only for now), `middlewares.ts`, `map-invoice.ts`
- Modify: `src/api/middlewares.ts` (spread `invoiceMiddlewares`)
- Test: `integration-tests/http/invoices.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`ACCOUNTING_MODULE`, utils); `createSupplierProductWorkflow` and `deleteSupplierProductWorkflow` (`src/workflows/`); the purchase/supplier-product links read via `query.graph`.
- Produces: `CreateInvoiceSchema` / `CreateInvoiceSchema` type in `middlewares.ts`: `{ purchase_id, invoice_number, invoice_date (YYYY-MM-DD string), due_date?, shipping_cost?, tax?, other_cost?, notes?, items: { supplier_sku?: string; variant_id?: string; remember_code?: boolean; purchase_item_id?: string; quantity: int>=1; unit_cost: >=0; description?: string }[] (min 1) }`. Each item needs `supplier_sku` or `variant_id`; `remember_code` requires both.
- Produces `createInvoiceWorkflow` (input = validated body) and `mapInvoice(row, extras)` returning `{ id, reference, status, invoice_number, invoice_date, due_date, supplier: {id,name}|null, purchase: {id, reference}|null, items: [{ id, purchase_item_id, variant_id, supplier_sku, description, quantity, unit_cost, line_total }], shipping_cost, tax, other_cost, subtotal, total, notes, posted_at, voided_at, created_at }`.
- Produces `POST /admin/invoices` → `{ invoice }`.

- [ ] **Step 1: Write the failing HTTP tests** (set up a supplier, products/variants, supplier-product entries and an ordered purchase through the real routes, as `purchases.spec.ts` and `supplier-products.spec.ts` do):
  - Create by `supplier_sku` resolves the variant (case and spaces ignored) and links the line to the purchase item with that variant; response has `reference` `INV-0001`, correct `subtotal`/`total`, supplier from the purchase.
  - Unknown code returns 400 naming the code. `variant_id` + `supplier_sku` + `remember_code: true` adds the supplier-product entry (visible via `GET /admin/suppliers/:id/products`) and the invoice; remember-code of a code already on the list returns the existing 400 message and creates no invoice.
  - Failure after remember: force the create step to fail (jest spy on the accounting service, restored in `finally`); afterwards no supplier-product entry and no invoice exist.
  - A variant not on the purchase is saved with `purchase_item_id: null`; a variant on the purchase twice requires `purchase_item_id` (400 otherwise); a `purchase_item_id` from another purchase returns 400.
  - Unknown purchase 404; unauthenticated 401; blank invoice number, `quantity: 0`, negative cost, bad date return 400.
  - Duplicate: second create with the same supplier number (any case/spacing) returns 400 naming supplier and number; allowed for a different supplier; allowed again after the first is voided (set status void through the module service in the test); concurrent pair via `Promise.all` yields exactly one 200 and one 400.
  - Stock unchanged: inventory levels before and after create are identical.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:integration:http integration-tests/http/invoices.spec.ts`.
- [ ] **Step 3: Implement.**
  - Resolve step (read-only): reads the purchase (404; supplier via the purchase link) and the supplier's product list, resolves each line to `variant_id`, `supplier_sku`, description default (the purchase item title or supplier title), and the `purchase_item_id` per the spec's matching rules.
  - Create step: takes the lock `invoiceLockKey(supplier_id, key)` around "duplicate pre-check + create"; also maps a unique-violation from the database to the same duplicate message (reuse the approach in `src/workflows/steps/supplier-product-helpers.ts`: check code 23505 on the error and cause, fall back to re-querying for the conflicting row). Creates the invoice with nested items. Compensation deletes items then invoice.
  - Remember step runs before the create step, only for lines with `remember_code`, by running `createSupplierProductWorkflow(container).run(...)` per line inside one step; its compensation runs `deleteSupplierProductWorkflow` for those it created.
  - Workflow then `createRemoteLinkStep` with `{ accounting: { invoice_id }, purchase: { purchase_id } }` and each item to `[Modules.PRODUCT]: { product_variant_id }` (key names per the link definitions).
  - Zod validation as in Interfaces; money fields numbers.
- [ ] **Step 4: Run Step 2 command, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add create invoice workflow and route`.

---

### Task 3: Read routes and comparison

**Files:**
- Create: `src/api/admin/invoices/compare-invoice.ts`, `src/api/admin/invoices/[id]/route.ts` (GET)
- Modify: `src/api/admin/invoices/route.ts` (add GET), `middlewares.ts` (list query schema), `map-invoice.ts`
- Test: `src/api/admin/invoices/__tests__/compare-invoice.unit.spec.ts`, `integration-tests/http/invoices.spec.ts`

**Interfaces:**
- Consumes: Task 2's `mapInvoice`, `PURCHASE_FIELDS`-style field list from `src/api/admin/purchases/map-purchase.ts`.
- Produces `compareInvoice(input: { purchase_items: { id: string; variant_id: string; title: string; quantity: number; quantity_received: number; unit_cost: number }[]; lines: { purchase_item_id: string|null; variant_id: string; description: string; quantity: number; unit_cost: number }[]; other_invoiced: { purchase_item_id: string; quantity: number }[]; purchase_total: number; invoice_total: number }): { items: { purchase_item_id: string|null; variant_id: string; title: string; ordered_quantity: number; received_quantity: number; invoiced_quantity: number; invoiced_quantity_total: number; ordered_unit_cost: number|null; invoiced_unit_cost: number|null; flags: { price_difference: boolean; over_received: boolean; over_ordered: boolean; not_on_purchase: boolean } }[]; purchase_total: number; invoice_total: number; difference: number }`. Purchase items with no line on this invoice are included with `invoiced_quantity: 0` and no price flag. `invoiced_quantity_total` = this invoice's lines plus `other_invoiced` (posted invoices of the same purchase, excluding this invoice). Price comparison uses 2-decimal rounding.
- Produces `GET /admin/invoices` → `{ invoices, count, offset, limit }` (rows include `items`; filters `purchase_id`, `supplier_id`, `status`, `q`; `limit` 1..100 default 20, `offset`; newest first, `id` tiebreak) and `GET /admin/invoices/:id` → `{ invoice, comparison }` (404 for unknown).

- [ ] **Step 1: Write the failing tests.** Unit: each flag on its own and combined; a purchase item with no line; a line with null `purchase_item_id` flagged `not_on_purchase`; `other_invoiced` makes `over_ordered` true when the total exceeds ordered; rounding at the price comparison (`0.1+0.2` vs `0.3` is equal); header difference. HTTP: list filters (each), `q` finds by number case-insensitively and `%`/`_` match literally, whitespace-only `q` is ignored, pagination count; detail numbers for a purchase with two posted invoices; a purchase whose variant was deleted from the catalog still returns 200 with the line; unknown id 404.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (list via `query.graph` on `invoice` with a `$or` on `invoice_number`; purchase and supplier names read through the links; compute `comparison` from the purchase items and the posted invoices' items). **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add invoice list, detail and comparison`.

---

### Task 4: Update draft invoice

**Files:**
- Create: `src/workflows/update-invoice.ts`, `src/workflows/steps/update-invoice.ts`
- Modify: `src/api/admin/invoices/[id]/route.ts` (POST), `middlewares.ts`
- Test: `integration-tests/http/invoices.spec.ts`

**Interfaces:**
- Consumes: Task 2's resolve/remember steps (reuse, do not copy).
- Produces `UpdateInvoiceSchema`: every create field optional (`purchase_id` not accepted — strict schema, 400); `items`, when present, replaces all lines. `POST /admin/invoices/:id` → `{ invoice }`.

- [ ] **Step 1: Write the failing tests:** editing header fields only leaves lines unchanged; replacing `items` replaces them and the totals follow; changing `invoice_number` to one already used by that supplier returns 400, to its own current number is fine; `purchase_id` in the body returns 400; a posted or void invoice returns 400 "locked" and nothing changes; a failure while replacing lines (forced) restores the old lines, header and links; remember-code works on update and rolls back with it; unknown id 404.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (draft check inside the `invoiceStatusLockKey` lock; snapshot for compensation; links for replaced lines dismissed and recreated). **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add update draft invoice`.

---

### Task 5: Post and void

**Files:**
- Create: `src/workflows/post-invoice.ts`, `src/workflows/void-invoice.ts`, steps with the same names, `src/api/admin/invoices/[id]/post/route.ts`, `[id]/void/route.ts`
- Test: `integration-tests/http/invoices.spec.ts`

**Interfaces:**
- Consumes: `invoiceStatusLockKey` (Task 1).
- Produces `POST /admin/invoices/:id/post` and `POST /admin/invoices/:id/void`, each → `{ invoice }`.

- [ ] **Step 1: Write the failing tests:** post sets `status` posted and `posted_at`; post of an invoice with no lines returns 400; post against a cancelled or draft purchase returns 400; posting twice returns 400 and `posted_at` is unchanged; edits after post are refused (Task 4 behavior); void from draft and from posted sets `void` and `voided_at` and frees the number; void of a void invoice returns 400; `Promise.all` of post and void on one draft invoice leaves exactly one consistent final state and exactly one request succeeds; a posted invoice counts in another invoice's `invoiced_quantity_total`, a void one does not; stock unchanged by post and void.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (read-check-write inside `invoiceStatusLockKey(id)`; compensation restores the previous status and timestamps). **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add post and void invoice`.

---

### Task 6: Accounting menu and Invoices list page

**Files:**
- Create: `src/admin/routes/accounting/page.tsx` (config label "Accounting"; redirects to `/accounting/invoices` with `<Navigate replace />`), `src/admin/routes/accounting/invoices/page.tsx` (config label "Invoices"), `src/admin/routes/accounting/types.ts` (`AdminInvoice`, `InvoiceComparison` matching Tasks 2–3)
- Test: `src/admin/routes/accounting/invoices/__tests__/page.unit.spec.tsx`

**Interfaces:** Consumes `GET /admin/invoices`. Follow `src/admin/routes/purchases/page.tsx` for the table, status badges and `format.ts` money helpers.

- [ ] **Step 1: Write the failing tests** (stateful mock server, fresh response objects, wait for rendered signals, flush before "no call" assertions, prove key tests fail against a deliberately broken variant and record the RED): rows show reference, supplier, supplier invoice number, purchase reference, date, total (USD, no /100), status badge; the reference links to `/accounting/invoices/<id>`; status filter and search send `status` / `q` and reset the offset; pagination Next/Previous and clamp when the count shrinks; empty state; error state with working Retry; a "New invoice" button links to `/accounting/invoices/new`; the route configs: accounting has label "Accounting", invoices has label "Invoices" and no `nested`.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/admin/routes/accounting`. **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add accounting menu and invoices list`.

---

### Task 7: New invoice page

**Files:**
- Create: `src/admin/routes/accounting/invoices/new/page.tsx`, `new/line-entry.ts` (pure helpers), components under `src/admin/routes/accounting/invoices/new/components/` as needed
- Test: `new/__tests__/page.unit.spec.tsx`, `new/__tests__/line-entry.unit.spec.ts`

**Interfaces:**
- Consumes: `GET /admin/purchases` (status filter `ordered`, `partially_received`, `received`; client-side text filter on reference and supplier name), `GET /admin/invoices?purchase_id=` (to compute uninvoiced quantities), `GET /admin/suppliers/:id/products?q=` (exact case-insensitive match on `supplier_sku` to resolve a typed code), `sdk.admin.productVariant.list({ q, limit: 5, fields: "id,title,sku,product.title" })` for the unknown-code product picker (show at most 5, search as you type with a short debounce), `POST /admin/invoices`.
- Produces `?purchase_id=` query param support: the page opens with that purchase preselected (used by Task 8).
- Pure helpers in `line-entry.ts`: `prefillLines(purchaseItems, existingInvoices): Line[]` (quantity = max(0, ordered − already invoiced by non-void invoices), ordered cost; lines with quantity 0 omitted); `buildCreateBody(state): CreateInvoiceBody`.

- [ ] **Step 1: Write the failing tests:** choosing a purchase prefills lines (uninvoiced quantity, ordered cost) and shows live subtotal/total using plain dollars; editing quantity/cost updates totals; removing a line; typing a known code adds a line for its variant with the supplier's cost prefilled and the purchase item linked; typing an unknown code shows the product picker (5 results max) and, once a product is chosen, an optional "Remember this code for this supplier" checkbox, and the POST body then carries `variant_id`, `supplier_sku`, `remember_code`; a server 400 (duplicate number) is shown inline and keeps the form; Save is disabled without invoice number, date and at least one valid line; success toast and navigation to the new invoice; `?purchase_id=` preselects; a failed purchase list shows Retry. Warnings for price/quantity differences are shown from local data (ordered cost and quantities) without blocking Save. Prove key tests fail against a deliberately broken variant (record the RED).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add new invoice page`.

---

### Task 8: Invoice detail page and purchase page entry

**Files:**
- Create: `src/admin/routes/accounting/invoices/[id]/page.tsx`, components under `[id]/components/`
- Modify: `src/admin/routes/purchases/[id]/page.tsx` (add "Record invoice" button linking to `/accounting/invoices/new?purchase_id=<id>` and an "Invoices" section listing that purchase's invoices from `GET /admin/invoices?purchase_id=`)
- Test: `[id]/__tests__/page.unit.spec.tsx`, `src/admin/routes/purchases/[id]/__tests__/page.unit.spec.tsx`

**Interfaces:** Consumes `GET /admin/invoices/:id` (`invoice`, `comparison`), `POST /admin/invoices/:id` (draft edit of header fields and per-line quantity/cost; no add-line on this page — use New invoice for that), `POST .../post`, `POST .../void`.

- [ ] **Step 1: Write the failing tests:** header and lines render with reference, supplier, purchase link, dates and totals; comparison table shows ordered/received/invoiced quantities and costs and the four warning badges (each asserted); Post and Void appear only when allowed (draft: Post, Void and edit; posted: Void; void: none) and call the right route with a confirmation (`usePrompt`) before void; server errors show as toasts and inline; editing a draft saves only changed fields and does not lose unsaved edits when the page refetches (key the form by invoice id; no effect that resets on refetch); 404 shows "Invoice not found"; purchase page shows the button with the right link and lists invoices (reference, number, total, status) with links, and an empty message. Prove key tests fail against broken variants (record the RED).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add invoice detail page and purchase invoice links`.

---

### Task 9: Whole-branch verification

- [ ] **Step 1:** `yarn build` (backend and admin build; lint 0 errors).
- [ ] **Step 2:** `yarn test:unit src/modules src/workflows src/api src/admin`, `yarn test:integration:modules`, `yarn test:integration:http` (all pass; the "Connection ended unexpectedly" teardown noise is known).
- [ ] **Step 3:** Report that `npx medusa db:migrate` must be run on the dev database (new accounting tables and two link tables). Do not run it unless the controller says so. Commit only if files changed.
