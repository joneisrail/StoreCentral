# Supplier Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add richer supplier records, active/inactive, a supplier purchase summary, and a per-supplier product list that maps the supplier's own code and name to existing product variants.

**Architecture:** Extends the existing `supplier` module (new fields, new `SupplierProduct` model) with a module link to Product Variant, new workflows and admin routes, and a supplier detail page with Details / Products / Purchases tabs. Purchase history reads purchases through the existing purchase-supplier link in a route; modules never import each other.

**Tech Stack:** Medusa v2 (DML, `MedusaService`, workflows, `query.graph`, module links), Zod from `@medusajs/framework/zod`, Medusa admin extensions (React, `@medusajs/ui`, `sdk.client.fetch`), jest, `medusaIntegrationTestRunner`, `moduleIntegrationTestRunner`.

**Spec:** `docs/superpowers/specs/2026-11-06-supplier-enhancements-design.md` (builds on `2026-11-06-supplier-and-purchase-modules-design.md`).

## Global Constraints

All paths below are relative to `apps/backend/` unless they start with `docs/`. Run commands from `apps/backend`.

- Zod is imported from `@medusajs/framework/zod`. Only GET, POST, DELETE routes. Every mutation goes through a workflow; routes validate and call it. Errors are `MedusaError`.
- Migrations are generated with `npx medusa db:generate supplier`, never hand-written. Module names stay camelCase.
- Money is plain dollars (`model.bigNumber()`, 12.50 stored as 12.50). Serialize money to `number` (or `null`) in responses as `src/api/admin/purchases/map-purchase.ts` does.
- The supplier module must not import the purchase module or read product tables; connections use links and `query.graph`.
- Admin pages call the backend with `sdk.client.fetch` only, show toasts for mutation results, and follow the existing supplier and purchase pages.
- Payments are out of scope. Products are never created or edited here.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `feat/supplier-enhancements`.
- Test commands: `yarn test:unit <path>`, `yarn test:integration:modules <path>`, `yarn test:integration:http <path>`. Unit tests live in `__tests__/*.unit.spec.ts(x)`.

## Review Focus

- Two simultaneous adds of the same supplier code or variant: the database unique index decides, and the loser gets a 400 with the same message as the pre-check (Task 4 test).
- Existing suppliers after the migration are active with empty new fields (Task 1 test).
- A linked variant deleted from the catalog: list rows still render with `variant: null` (Task 4 test).
- Search text with `%`, `_` or only spaces matches literally or is ignored (Tasks 1 and 4 tests).
- Optional text fields can be cleared by sending `null` (Task 1 test).

---

### Task 1: Supplier fields, active flag, inactive blocks new purchases

**Files:**
- Modify: `src/modules/supplier/models/supplier.ts`
- Create (generated): new migration under `src/modules/supplier/migrations/`
- Create: `src/modules/supplier/utils.ts`, `src/api/admin/suppliers/fields.ts`
- Modify: `src/api/admin/suppliers/middlewares.ts`, `src/api/admin/suppliers/route.ts`, `src/api/admin/suppliers/[id]/route.ts`
- Modify: `src/workflows/steps/create-supplier.ts`, `update-supplier.ts`, `delete-supplier.ts`, `resolve-purchase-items.ts`
- Test: `src/modules/supplier/__tests__/supplier-module-service.spec.ts`, `src/modules/supplier/__tests__/supplier-utils.unit.spec.ts`, `integration-tests/http/suppliers.spec.ts`, `integration-tests/http/purchases.spec.ts`

**Interfaces:**
- Produces: `escapeLike(q: string): string` (escapes `\`, `%`, `_`) in `src/modules/supplier/utils.ts`; `SUPPLIER_FIELDS: string[]` in `src/api/admin/suppliers/fields.ts` (`id,name,email,phone,address,notes,contact_name,website,tax_id,payment_terms,lead_time_days,is_active,created_at`), used by both supplier GET routes.

- [ ] **Step 1: Write the failing tests**
  - Unit: `escapeLike("50%_off\\")` returns `"50\\%\\_off\\\\"`.
  - Module: creating a supplier with only a name gives `is_active === true` and every new field `null`; `updateSuppliers({id, is_active:false})` persists.
  - HTTP (`suppliers.spec.ts`): create with all new fields returns them; `POST /admin/suppliers/:id` with `{ website: null, lead_time_days: null }` clears them; `lead_time_days: -1` and `1.5` return 400; `GET ?is_active=false` returns only inactive, `?is_active=true` only active, omitted returns both; `GET ?q=50%25` matches only a supplier literally named with `50%`; a supplier created before the change (create via module service with only a name) is active with null new fields.
  - HTTP (`purchases.spec.ts`): `POST /admin/purchases` for an inactive supplier returns 400 with a message containing "inactive"; receiving goods on an existing purchase of a supplier made inactive afterwards still succeeds.
- [ ] **Step 2: Run them, expect FAIL** — `yarn test:unit src/modules/supplier`, `yarn test:integration:modules src/modules/supplier`, `yarn test:integration:http integration-tests/http/suppliers.spec.ts integration-tests/http/purchases.spec.ts`.
- [ ] **Step 3: Implement.**
  - Model: add nullable `contact_name`, `website`, `tax_id`, `payment_terms` (text), nullable `lead_time_days` (`model.number()`), and `is_active: model.boolean().default(true)`. Run `npx medusa db:generate supplier`.
  - `utils.ts`: `escapeLike`. Use it in the existing `q` filter of `GET /admin/suppliers` (`{ $ilike: \`%${escapeLike(q)}%\` }`).
  - Schemas: create gains the new fields (all optional; `lead_time_days` int >= 0; `is_active` boolean). Update schema: every optional text field and `lead_time_days` also accept `null` to clear (this also fixes the deferred "email can't be cleared" item); `name` stays non-null. List query gains `is_active: z.enum(["true","false"]).optional()` applied as a boolean filter.
  - Use `SUPPLIER_FIELDS` in both GET routes. Add the new fields to the create/update step input types and to the compensation snapshots in `update-supplier.ts` and `delete-supplier.ts` (a rollback must restore them).
  - `resolve-purchase-items.ts`: also select `is_active`; if false throw `MedusaError.Types.NOT_ALLOWED` with `Supplier <name> is inactive and cannot be used for new purchases`.
- [ ] **Step 4: Run the Step 2 commands, expect PASS.** Also `npx tsc --noEmit -p .` and `yarn lint` clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier details and active status`.

---

### Task 2: SupplierProduct model, variant link, SKU normalization

**Files:**
- Create: `src/modules/supplier/models/supplier-product.ts`, generated migration, `src/links/supplier-product-variant.ts`
- Modify: `src/modules/supplier/models/supplier.ts` (add `products: model.hasMany(() => SupplierProduct, { mappedBy: "supplier" })`), `src/modules/supplier/service.ts` (add `SupplierProduct` to `MedusaService`), `src/modules/supplier/utils.ts`
- Test: `src/modules/supplier/__tests__/supplier-product.spec.ts`, `src/modules/supplier/__tests__/supplier-utils.unit.spec.ts`

**Interfaces:**
- Produces: `normalizeSupplierSku(raw: string): { supplier_sku: string; supplier_sku_key: string }` — trims; key is trimmed and lower-cased; throws `MedusaError` INVALID_DATA "Supplier code is required" for empty/whitespace.
- Produces: `SupplierProduct` fields `id`, `supplier` (belongsTo; column `supplier_id`), `variant_id`, `supplier_sku`, `supplier_sku_key`, `supplier_title?`, `unit_cost?` (bigNumber, nullable), `notes?`. Unique indexes on (`supplier_id`, `variant_id`) and (`supplier_id`, `supplier_sku_key`); service methods `createSupplierProducts`, `listSupplierProducts`, `updateSupplierProducts`, `deleteSupplierProducts`.
- Produces: link default-exported from `src/links/supplier-product-variant.ts`: `defineLink({ linkable: SupplierModule.linkable.supplierProduct, isList: true }, ProductModule.linkable.productVariant)`.

- [ ] **Step 1: Write the failing tests.**
  - Unit: `normalizeSupplierSku("  AB-12 ")` → `{ supplier_sku: "AB-12", supplier_sku_key: "ab-12" }`; `""` and `"   "` throw.
  - Module: same supplier + same `supplier_sku_key` twice rejects; same supplier + same `variant_id` twice rejects; a different supplier may reuse both the code and the variant; after `deleteSupplierProducts` (soft delete) the same code and variant can be added again; `unit_cost: 12.5` round-trips and omitted `unit_cost` is null.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/modules/supplier`, `yarn test:integration:modules src/modules/supplier`.
- [ ] **Step 3: Implement** the model with `.indexes([...])` for both unique pairs, `normalizeSupplierSku`, the link, then `npx medusa db:generate supplier` (a second migration). The test runners create their own databases; do not run `db:migrate` against the dev database in this task. The link table is created by `db:migrate` later (Task 9 reports this).
- [ ] **Step 4: Run Step 2 commands, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier product model and variant link`.

---

### Task 3: Supplier product workflows and routes

**Files:**
- Create: `src/workflows/create-supplier-product.ts`, `update-supplier-product.ts`, `delete-supplier-product.ts` and steps under `src/workflows/steps/` with the same names
- Create: `src/api/admin/suppliers/[id]/products/route.ts`, `src/api/admin/suppliers/[id]/products/[product_id]/route.ts`, `src/api/admin/suppliers/map-supplier-product.ts`
- Modify: `src/api/admin/suppliers/middlewares.ts`
- Test: `integration-tests/http/supplier-products.spec.ts`

**Interfaces:**
- Consumes: `normalizeSupplierSku`, `escapeLike` (Tasks 1–2), `SupplierModuleService`, the Task 2 link.
- Produces routes (all under `/admin/suppliers/:id/products`):
  - `GET ?q&variant_id&limit&offset` → `{ supplier_products, count, offset, limit }`.
  - `POST {variant_id, supplier_sku, supplier_title?, unit_cost?, notes?}` → `{ supplier_product }`.
  - `POST /:product_id {supplier_sku?, supplier_title?, unit_cost?, notes?}` (title, cost, notes accept `null`; `variant_id` not accepted) → `{ supplier_product }`.
  - `DELETE /:product_id` → `{ id, object: "supplier_product", deleted: true }`.
- Row shape from `mapSupplierProduct`: `{ id, supplier_id, variant_id, supplier_sku, supplier_title, unit_cost: number|null, notes, variant: { id, title, sku, product: { id, title } } | null }`.

- [ ] **Step 1: Write the failing HTTP tests** (create a supplier and real products/variants through the product module the way `purchases.spec.ts` does):
  - POST links a variant; response row includes the variant title/SKU and product title; `GET` lists it.
  - 404 for an unknown supplier; 400 for an unknown `variant_id`; 400 "already on this supplier's list" for a repeated variant; 400 "code ... already used" for a repeated code differing only in case/spaces; another supplier may use the same code and variant.
  - Race: `Promise.all` of two POSTs with the same code but different variants → exactly one 200 and one 400 with the same code-already-used message.
  - Edit changes code/title/cost; editing to another entry's code returns 400; `unit_cost: null` clears the cost; a body containing `variant_id` is ignored/rejected (400 under strict schema); a `product_id` that belongs to a different supplier returns 404.
  - DELETE removes the entry, and `GET /admin/product-variants/:id` / the variant still exists; deleting twice returns 404.
  - Search: `q` matches supplier code, supplier title, our variant SKU, variant title and product title (one assertion each); `q=%` returns nothing unless a value literally contains `%`; `q=   ` behaves as no filter; `variant_id=<id>` returns only that variant's entry; pagination `limit/offset/count`.
  - Variant deleted from the catalog (`DELETE /admin/products/:id`) → `GET` still 200 and the row has `variant: null`.
  - An inactive supplier can still add, edit and unlink.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:integration:http integration-tests/http/supplier-products.spec.ts`.
- [ ] **Step 3: Implement.**
  - Create step: verify supplier and variant exist (query), pre-check duplicates for friendly messages, `createSupplierProducts` with normalized sku, and catch a unique-violation error from the database and rethrow as `INVALID_DATA` with the same messages (this is what makes the race test pass). Workflow then `createRemoteLinkStep` (`supplier: { supplier_product_id }` ↔ `[Modules.PRODUCT]: { product_variant_id }`). Compensation deletes the row.
  - Update step: load by id + supplier (404 on mismatch), re-normalize sku if changed, same duplicate handling, snapshot for compensation.
  - Delete workflow: `dismissRemoteLinkStep` then delete step (compensation recreates the row; the link is restored by the dismiss step's own compensation).
  - GET: if `q` is non-empty after trim, first `query.graph` on `product_variant` with `$or` of `sku`, `title`, `product.title` `$ilike` (escaped) to collect variant ids, then `query.graph` on `supplier_product` filtered by `supplier_id` and `$or` of `supplier_sku`, `supplier_title` `$ilike` and `variant_id: { $in: ids }` (omit the last when no ids). Fetch each row's variant via the link fields. Order by `created_at DESC`.
  - Validation: `supplier_sku` min 1 after trim, `unit_cost` >= 0, strict body schemas.
- [ ] **Step 4: Run Step 2 command, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier product routes and workflows`.

---

### Task 4: Supplier purchase summary

**Files:**
- Create: `src/api/admin/suppliers/summarize-purchases.ts`, `src/api/admin/suppliers/[id]/summary/route.ts`
- Test: `src/api/admin/suppliers/__tests__/summarize-purchases.unit.spec.ts`, `integration-tests/http/suppliers.spec.ts`

**Interfaces:**
- Produces: `summarizePurchases(purchases: { status: string; shipping_cost: number; tax: number; other_cost: number; items: { quantity: number; quantity_received: number; unit_cost: number }[] }[]): { counts: Record<string, number>; total_ordered: number; total_received: number; outstanding: number }` — pure; counts include every status present; the three money figures cover only purchases whose status is not `draft` or `cancelled`; `total_ordered` = sum of `calculatePurchaseTotals` totals (import it from `src/modules/purchase/utils.ts`, a pure function, not the service); `total_received` = sum of `quantity_received * unit_cost`; `outstanding` = sum of `(quantity - quantity_received) * unit_cost`; all rounded to 2 decimals.
- Produces: `GET /admin/suppliers/:id/summary` → `{ summary: ReturnType<typeof summarizePurchases> }`; 404 for an unknown supplier.

- [ ] **Step 1: Write the failing tests.**
  - Unit: no purchases → all zeros and empty counts; one ordered purchase of 10 @ 2.50 with shipping 5 → `total_ordered 30`, `total_received 0`, `outstanding 25`; same after receiving 4 → `total_received 10`, `outstanding 15`; a draft and a cancelled purchase appear in `counts` but add nothing to the money figures; rounding `3 @ 0.1` gives `0.3`.
  - HTTP: create two suppliers, place/receive purchases through the real routes, assert the summary for one equals the hand-computed figures and the other supplier is unaffected; unknown id returns 404.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/api/admin/suppliers`, `yarn test:integration:http integration-tests/http/suppliers.spec.ts`.
- [ ] **Step 3: Implement.** The route reads the supplier's purchases with `query.graph` (`purchases.status`, costs, `purchases.items.*`) and convert money with `Number()`.
- [ ] **Step 4: Run Step 2 commands, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier purchase summary`.

---

### Task 5: Supplier detail page — shell, Details tab, list changes

**Files:**
- Create: `src/admin/routes/suppliers/types.ts` (shared `Supplier`, `SupplierProductRow`, `SupplierSummary` types matching the API), `src/admin/routes/suppliers/[id]/page.tsx`, `src/admin/routes/suppliers/[id]/components/details-tab.tsx`
- Modify: `src/admin/routes/suppliers/page.tsx`
- Test: `src/admin/routes/suppliers/[id]/__tests__/page.unit.spec.tsx`, `src/admin/routes/suppliers/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `GET/POST /admin/suppliers/:id` and `GET /admin/suppliers?is_active=` from Task 1.
- Produces: the detail page at `/suppliers/:id` with `Tabs` named Details, Products, Purchases; Products and Purchases render placeholders that Tasks 6 and 7 replace by exporting `ProductsTab` and `PurchasesTab` from `components/products-tab.tsx` and `components/purchases-tab.tsx` (each taking `{ supplierId: string }`). Create these two files now as minimal stubs so the page compiles.

- [ ] **Step 1: Write the failing tests** (mock `sdk.client.fetch` as the existing supplier page spec does):
  - List: rows link to `/suppliers/<id>`; an Active/Inactive/All select adds `is_active` to the request; inactive suppliers show an "Inactive" badge; create drawer still works with the new fields; the old edit drawer is gone.
  - Detail Details tab: loads and shows all fields; editing and saving posts only the changed fields and shows a success toast; clearing the website posts `website: null`; the active switch posts `is_active`; a failed save shows the error message; a 404 shows "Supplier not found".
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/admin/routes/suppliers`.
- [ ] **Step 3: Implement** following `purchases/[id]/page.tsx` for the detail page structure and the existing list page for style; remove the edit-drawer code from the list page.
- [ ] **Step 4: Run Step 2 command, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier detail page with details tab`.

---

### Task 6: Products tab

**Files:**
- Modify: `src/admin/routes/suppliers/[id]/components/products-tab.tsx`
- Create: `src/admin/routes/suppliers/[id]/components/add-product-dialog.tsx`
- Test: `src/admin/routes/suppliers/[id]/components/__tests__/products-tab.unit.spec.tsx`

**Interfaces:**
- Consumes: Task 3 routes; `sdk.admin.productVariant.list({ q, limit, fields: "id,title,sku,product.title" })` for the variant search, as the New purchase page does.
- Produces: `ProductsTab({ supplierId })`.

- [ ] **Step 1: Write the failing tests:** the list shows supplier code, supplier name, our product/variant title and SKU, and cost; the search box sends `q` and shows "No products found" when empty; a row whose `variant` is null shows "Product removed from catalog"; the Add dialog searches variants, picks one, requires a supplier code, posts `variant_id`, `supplier_sku`, optional title/cost, and refreshes the list; a 400 from the server (duplicate code) is shown inside the dialog; Edit changes code/title/cost; Unlink asks for confirmation (`usePrompt`) and calls DELETE.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/admin/routes/suppliers`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier products tab`.

---

### Task 7: Purchases tab

**Files:**
- Modify: `src/admin/routes/suppliers/[id]/components/purchases-tab.tsx`
- Test: `src/admin/routes/suppliers/[id]/components/__tests__/purchases-tab.unit.spec.tsx`

**Interfaces:**
- Consumes: `GET /admin/suppliers/:id/summary` (Task 4) and `GET /admin/purchases?supplier_id=<id>` (existing); the purchase row/format helpers in `src/admin/routes/purchases/format.ts` and `types.ts`.
- Produces: `PurchasesTab({ supplierId })`.

- [ ] **Step 1: Write the failing tests:** summary cards show counts per status and `total_ordered`, `total_received`, `outstanding` formatted as USD; the list shows reference, status, total and links to `/purchases/<id>`; a supplier with no purchases shows an empty message and zero cards; a failed summary request shows an error with Retry.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier purchases tab`.

---

### Task 8: New purchase page — active suppliers and cost prefill

**Files:**
- Modify: `src/admin/routes/purchases/new/page.tsx`
- Test: `src/admin/routes/purchases/new/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `GET /admin/suppliers?is_active=true`; `GET /admin/suppliers/:id/products?variant_id=<id>`.

- [ ] **Step 1: Write the failing tests:** the supplier request includes `is_active=true`; adding a variant while a supplier is chosen requests that variant's entry and, when it has a `unit_cost`, prefills the cost field and shows the supplier code beside the title; a variant with no entry or no cost leaves the cost empty; the admin can overwrite the prefilled cost; changing the supplier after items are added leaves their costs unchanged; a failed lookup does not block adding the item.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/admin/routes/purchases/new`.
- [ ] **Step 3: Implement** the lookup when a variant is added (not on supplier change).
- [ ] **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): prefill purchase cost from supplier products`.

---

### Task 9: Whole-branch verification

- [ ] **Step 1:** `yarn build` (expect backend and frontend build success, lint 0 errors).
- [ ] **Step 2:** `yarn test:unit src/modules src/workflows src/api src/admin`, `yarn test:integration:modules`, `yarn test:integration:http` (expect all pass; ignore the known "Connection ended unexpectedly" teardown noise, which was already present).
- [ ] **Step 3:** Report that `npx medusa db:migrate` must be run on the dev database; do not run it. Commit only if the steps changed files.
