# Supplier and Purchase Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin users keep supplier records and record purchases of products for resale, with partial deliveries that raise Medusa stock when goods arrive.

**Architecture:** Two new Medusa modules, `supplier` and `purchase`, linked to each other and to Product Variant and Stock Location through module links. Eight workflows carry all business rules; the receive workflow reuses core `adjustInventoryLevelsStep` / `createInventoryLevelsStep` (which already roll back) and a lock so two deliveries cannot exceed the ordered quantity. Admin-only API routes call the workflows, and new dashboard pages (Suppliers, Purchases) call the routes through the JS SDK.

**Tech Stack:** Medusa v2 (modules, workflows, DML, module links), Zod v4, Jest (`test:unit`, `test:integration:modules`, `test:integration:http`), React + `@tanstack/react-query` + Medusa UI for the admin pages.

**Spec:** `docs/superpowers/specs/2026-11-06-supplier-and-purchase-modules-design.md`

## Global Constraints

- Module names are exactly `"supplier"` and `"purchase"` (camelCase, no dashes).
- Purchase statuses are exactly `draft`, `ordered`, `partially_received`, `received`, `cancelled`. Currency is fixed `"usd"` (no conversion, no per-purchase currency).
- Amounts (`unit_cost`, `shipping_cost`, `tax`, `other_cost`) are `model.bigNumber()` plain dollar values (12.50 is stored as 12.50, never cents) and default to 0 for the three purchase-level costs. Pure helpers take plain `number`s and round results to 2 decimals; code reading service results converts with `Number(...)`.
- Reference format is `PO-` plus the autoincrement `display_id` zero-padded to 4 digits (`PO-0001`, `PO-12345`). It is derived on read, not stored. (Spec said "reference"; this is the concurrency-safe way to generate it, and the spec is updated to match.)
- Items and costs are editable only in `draft`; supplier is fixed after creation. Goods are received only in `ordered` / `partially_received`. A purchase with any received quantity cannot be cancelled. A supplier with any purchase cannot be deleted. Over-receiving is blocked.
- Only GET, POST, DELETE. Every mutation goes through a workflow; routes only validate and call workflows. `/admin/*` is auto-protected: no `authenticate` entries.
- Zod is imported from `@medusajs/framework/zod`; export the schema and its inferred type. Admin pages use `sdk.client.fetch` via `src/admin/lib/sdk`, never raw `fetch`.
- Migrations are generated with `npx medusa db:generate <module>` (run in `apps/backend`) then `npx medusa db:migrate`; never hand-written or hand-edited.
- No semicolons, double quotes, 2-space indent, kebab-case filenames (per `AGENTS.md`). All paths below are relative to `apps/backend/` unless they start with `docs/`.

## Review Focus

- Two simultaneous receive requests that together exceed an item's remaining quantity: exactly one succeeds, the other is rejected, and stock rises only once. (Task 7)
- Receiving a variant with `manage_inventory = false` or no inventory item: rejected with a message naming the item; no receipt, no stock change. (Task 7)
- Receiving at a stock location that has no inventory level for the item yet: the level is created and ends up equal to the received quantity. (Task 7)
- Creating a purchase with an unknown supplier or variant id, quantity `0` / `1.5` / negative, or a negative cost: rejected before any row is written. (Task 4)
- A variant renamed after the purchase was made: the purchase detail still shows the SKU and title captured at creation. (Task 4)

---

## File Structure

```
src/modules/supplier/        index.ts, service.ts, models/supplier.ts, migrations/ (generated)
src/modules/purchase/        index.ts, service.ts, utils.ts,
                             models/{purchase,purchase-item,purchase-receipt,purchase-receipt-item}.ts,
                             migrations/ (generated)
src/links/                   purchase-supplier.ts, purchase-item-variant.ts,
                             purchase-receipt-stock-location.ts
src/workflows/               create-supplier, update-supplier, delete-supplier,
                             create-purchase, update-purchase, place-purchase-order,
                             cancel-purchase, receive-purchase-goods
src/workflows/steps/         one file per step (named in each task)
src/api/admin/suppliers/     route.ts, [id]/route.ts, middlewares.ts
src/api/admin/purchases/     route.ts, map-purchase.ts, middlewares.ts,
                             [id]/route.ts, [id]/order/route.ts,
                             [id]/receive/route.ts, [id]/cancel/route.ts
src/admin/routes/suppliers/  page.tsx
src/admin/routes/purchases/  page.tsx, [id]/page.tsx, new/page.tsx,
                             components/receive-goods-dialog.tsx
integration-tests/http/      suppliers.spec.ts, purchases.spec.ts
```

Tests sit in `__tests__/` beside the code, as in the `review` module.

---

### Task 1: Supplier module

**Files:**
- Create: `src/modules/supplier/{index.ts,service.ts,models/supplier.ts}`, generated migration
- Test: `src/modules/supplier/__tests__/supplier-module-service.spec.ts`
- Modify: `medusa-config.ts` (add `{ resolve: './src/modules/supplier' }` to `modules`)

**Interfaces:**
- Produces: `SUPPLIER_MODULE = "supplier"` exported from `src/modules/supplier/index.ts`; default export `SupplierModuleService extends MedusaService({ Supplier })` (gives `createSuppliers`, `updateSuppliers`, `deleteSuppliers`, `retrieveSupplier`, `listAndCountSuppliers`). `Supplier` fields: `id`, `name` (required), `email`, `phone`, `address`, `notes` (all nullable text except `name`).

- [ ] **Step 1: Write the failing test** using `moduleIntegrationTestRunner<SupplierModuleService>({ moduleName: "supplier", resolve: path.resolve(__dirname, "..") })` like `review-module-service.spec.ts`. Cases: `creates a supplier with only a name` (optional fields come back `null`); `rejects a supplier without a name`; `updates a supplier's phone`.
- [ ] **Step 2: Run to verify it fails.** Run: `yarn test:integration:modules src/modules/supplier/__tests__/supplier-module-service.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the DML model, service and `Module(SUPPLIER_MODULE, { service })` following `src/modules/review/`; register in `medusa-config.ts`; run `npx medusa db:generate supplier`.
- [ ] **Step 4: Run to verify it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add supplier module`.

---

### Task 2: Purchase module and calculation helpers

**Files:**
- Create: `src/modules/purchase/{index.ts,service.ts,utils.ts}`, the four model files, generated migration
- Test: `src/modules/purchase/__tests__/purchase-utils.unit.spec.ts`, `src/modules/purchase/__tests__/purchase-module-service.spec.ts`
- Modify: `medusa-config.ts` (register `./src/modules/purchase`)

**Interfaces:**
- Produces from `index.ts`: `PURCHASE_MODULE = "purchase"`; `PurchaseModuleService extends MedusaService({ Purchase, PurchaseItem, PurchaseReceipt, PurchaseReceiptItem })`.
- Models (DML): `Purchase` { `id`, `display_id` autoincrement, `status` enum default `"draft"`, `currency_code` text default `"usd"`, `shipping_cost`/`tax`/`other_cost` bigNumber default 0, `notes` nullable text, `ordered_at` nullable dateTime, `items` hasMany PurchaseItem, `receipts` hasMany PurchaseReceipt }. `PurchaseItem` { `id`, `purchase` belongsTo, `variant_id`, `sku`, `title`, `quantity` number, `quantity_received` number default 0, `unit_cost` bigNumber }. `PurchaseReceipt` { `id`, `purchase` belongsTo, `stock_location_id`, `received_at` dateTime, `note` nullable text, `items` hasMany PurchaseReceiptItem }. `PurchaseReceiptItem` { `id`, `receipt` belongsTo, `purchase_item_id` text, `quantity` number }.
- Produces from `utils.ts` (all pure):
  - `formatPurchaseReference(displayId: number): string`
  - `calculatePurchaseTotals(items: { quantity: number; unit_cost: number }[], extra: { shipping_cost: number; tax: number; other_cost: number }): { subtotal: number; total: number }`
  - `getRemainingQuantity(item: { quantity: number; quantity_received: number }): number`
  - `validateReceiveQuantities(items: { id: string; title: string; quantity: number; quantity_received: number }[], requested: { purchase_item_id: string; quantity: number }[]): void`, throwing `MedusaError(INVALID_DATA)`
  - `getStatusAfterReceipt(items: { quantity: number; quantity_received: number }[]): "partially_received" | "received"`

- [ ] **Step 1: Write the failing unit tests** in `purchase-utils.unit.spec.ts`. Assertions: `formatPurchaseReference(1)` is `"PO-0001"` and `(12345)` is `"PO-12345"`; totals for items `[{quantity:2,unit_cost:12.5},{quantity:1,unit_cost:0.1}]` with `{shipping_cost:5,tax:1.25,other_cost:0}` give `{ subtotal: 25.1, total: 31.35 }`; `0.1 + 0.2` style sums come back rounded (`0.3`); `getRemainingQuantity({quantity:10,quantity_received:4})` is `6`; `validateReceiveQuantities` throws for each of: quantity above remaining (message contains the item title and the remaining number), quantity `0`, quantity `1.5`, unknown `purchase_item_id`, empty `requested`; `getStatusAfterReceipt` gives `"partially_received"` while any item has remaining and `"received"` when all are full.
- [ ] **Step 2: Write the failing module test** (`moduleIntegrationTestRunner`, `moduleName: "purchase"`): a created purchase has status `"draft"`, `currency_code` `"usd"`, costs `0`, a numeric `display_id`, and two purchases get different, increasing `display_id`s; items created with `purchase_id` come back via `retrievePurchase(id, { relations: ["items"] })`.
- [ ] **Step 3: Run to verify both fail.** Run: `yarn test:unit src/modules/purchase/__tests__/purchase-utils.unit.spec.ts` and `yarn test:integration:modules src/modules/purchase/__tests__/purchase-module-service.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the models, service, `index.ts`, `utils.ts`, register in `medusa-config.ts`, run `npx medusa db:generate purchase`. Round money with `Math.round(x * 100) / 100`.
- [ ] **Step 5: Run to verify both pass** (same commands). Expected: PASS.
- [ ] **Step 6: Commit** `feat(backend): add purchase module and calculation helpers`.

---

### Task 3: Module links and supplier API

**Files:**
- Create: `src/links/{purchase-supplier,purchase-item-variant,purchase-receipt-stock-location}.ts`; `src/workflows/{create-supplier,update-supplier,delete-supplier}.ts`; `src/workflows/steps/{create-supplier,update-supplier,delete-supplier}.ts`; `src/api/admin/suppliers/{route.ts,[id]/route.ts,middlewares.ts}`
- Test: `integration-tests/http/suppliers.spec.ts`
- Modify: `src/api/middlewares.ts` (spread `supplierMiddlewares` like `reviewMiddlewares`)

**Interfaces:**
- Consumes: `SUPPLIER_MODULE`, `PURCHASE_MODULE` (Tasks 1-2).
- Produces: links via `defineLink`: Purchase to Supplier (`{ linkable: PurchaseModule.linkable.purchase, isList: true }, SupplierModule.linkable.supplier`), PurchaseItem to `ProductModule.linkable.productVariant` (`isList: true` on the item side), PurchaseReceipt to `StockLocationModule.linkable.stockLocation` (`isList: true`). Workflows `createSupplierWorkflow(input: { name: string; email?: string; phone?: string; address?: string; notes?: string })`, `updateSupplierWorkflow(input: { id: string } & Partial<same>)`, `deleteSupplierWorkflow(input: { id: string })`, each returning `WorkflowResponse({ supplier })` (delete returns `{ id }`). Exports `CreateSupplierSchema`, `UpdateSupplierSchema` and inferred types from `middlewares.ts`.

- [ ] **Step 1: Write the failing HTTP tests** (`medusaIntegrationTestRunner`, admin auth via `createAdminUser` like `reviews.spec.ts`): `POST /admin/suppliers creates a supplier` (200, body has `supplier.id`); `POST rejects a missing name with 400`; `GET /admin/suppliers lists, paginates and filters with q by name`; `GET /admin/suppliers/:id returns 404 for an unknown id`; `POST /admin/suppliers/:id updates the email`; `DELETE /admin/suppliers/:id removes a supplier with no purchases`; `DELETE refuses with 400 and keeps the supplier when it has a purchase` (create the purchase with `purchaseModule.createPurchases` and the link with `container.resolve(ContainerRegistrationKeys.LINK).create(...)`).
- [ ] **Step 2: Run to verify it fails.** Run: `yarn test:integration:http suppliers.spec.ts`. Expected: FAIL (404 on routes).
- [ ] **Step 3: Implement** links, steps (with compensation, like `update-review-status`), workflows, routes and middlewares. `delete-supplier` step checks purchases with `query.graph({ entity: "supplier", fields: ["id", "purchases.id"], filters: { id } })` and throws `MedusaError.Types.NOT_ALLOWED` ("Supplier has purchases and cannot be deleted") when any exist. `GET` list supports `q`, `limit`, `offset`.
- [ ] **Step 4: Run `npx medusa db:migrate`** to sync the link tables, then rerun the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add module links and supplier admin API`.

---

### Task 4: Create purchase and read routes

**Files:**
- Create: `src/workflows/create-purchase.ts`; `src/workflows/steps/{resolve-purchase-items,create-purchase}.ts`; `src/api/admin/purchases/{route.ts,map-purchase.ts,middlewares.ts,[id]/route.ts}`
- Test: `src/api/admin/purchases/__tests__/map-purchase.unit.spec.ts`, `integration-tests/http/purchases.spec.ts`
- Modify: `src/api/middlewares.ts` (spread `purchaseMiddlewares`)

**Interfaces:**
- Consumes: `calculatePurchaseTotals`, `formatPurchaseReference`, `getRemainingQuantity` (Task 2); links (Task 3).
- Produces: `createPurchaseWorkflow(input: { supplier_id: string; items: { variant_id: string; quantity: number; unit_cost: number }[]; shipping_cost?: number; tax?: number; other_cost?: number; notes?: string })` returning `WorkflowResponse({ purchase })`. `mapPurchaseForAdmin(purchase: PurchaseRow, supplier: { id: string; name: string } | null): AdminPurchase` where `AdminPurchase` is `{ id; reference; status; currency_code; supplier; items: { id; variant_id; sku; title; quantity; quantity_received; remaining; unit_cost }[]; receipts: { id; stock_location_id; received_at; note; items: { purchase_item_id; quantity }[] }[]; shipping_cost; tax; other_cost; subtotal; total; notes; ordered_at; created_at }`. `CreatePurchaseSchema` and type exported from `middlewares.ts`.

- [ ] **Step 1: Write the failing unit test** for `mapPurchaseForAdmin`: reference `PO-0007` for `display_id: 7`; `subtotal` / `total` computed; `remaining` per item; `supplier: null` passes through; money converted with `Number(...)`.
- [ ] **Step 2: Write the failing HTTP tests** in `purchases.spec.ts`: `POST /admin/purchases creates a draft with a PO- reference, linked supplier and item snapshots (sku and title copied from the variant)`; rejections, each asserting **no purchase row exists afterwards**: unknown supplier (404), unknown variant (404), quantity `0`, `1.5`, negative `unit_cost`, empty `items` (all 400); `GET /admin/purchases lists newest first, filters by status, and filters by supplier_id`; `GET /admin/purchases/:id returns items, totals and supplier`; `detail still shows the captured sku and title after the variant is renamed`; `GET unknown id returns 404`.
- [ ] **Step 3: Run to verify they fail.** Run: `yarn test:unit src/api/admin/purchases/__tests__/map-purchase.unit.spec.ts` and `yarn test:integration:http purchases.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** `resolvePurchaseItemsStep` loads the supplier and variants (`query.graph`, entity `product_variant`, fields `id`, `sku`, `title`) and throws `NOT_FOUND` for any missing; it returns items with `sku` and `title` snapshots. `createPurchaseStep` writes the purchase and items (compensation deletes them); the workflow then creates the supplier and item-variant links with core `createRemoteLinkStep` (link keys use the module name and `<model>_id`, as `upsert-review` does: `{ purchase: { purchase_id }, supplier: { supplier_id } }` and `{ purchase: { purchase_item_id }, [Modules.PRODUCT]: { product_variant_id } }`). The list route reads `query.graph` entity `purchase` with `items.*`, `receipts.*`, `receipts.items.*`, `supplier.id`, `supplier.name`; because `query.graph` cannot filter on a linked field, `supplier_id` is applied by first reading `supplier.purchases.id` and filtering `id: { $in: [...] }`.
- [ ] **Step 5: Run to verify they pass** (same commands). Expected: PASS.
- [ ] **Step 6: Commit** `feat(backend): add create purchase workflow and purchase read routes`.

---

### Task 5: Update a draft purchase

**Files:**
- Create: `src/workflows/update-purchase.ts`; `src/workflows/steps/update-purchase.ts`
- Modify: `src/api/admin/purchases/[id]/route.ts` (add `POST`), `src/api/admin/purchases/middlewares.ts` (add `UpdatePurchaseSchema`)
- Test: add to `integration-tests/http/purchases.spec.ts`

**Interfaces:**
- Consumes: `resolvePurchaseItemsStep` (Task 4).
- Produces: `updatePurchaseWorkflow(input: { purchase_id: string; items?: { variant_id: string; quantity: number; unit_cost: number }[]; shipping_cost?: number; tax?: number; other_cost?: number; notes?: string })` returning `WorkflowResponse({ purchase })`. `items`, when given, replace all existing items (their old item-variant links are dismissed, new ones created).

- [ ] **Step 1: Write the failing tests:** `POST /admin/purchases/:id replaces items and updates costs on a draft` (totals reflect the new items); `rejects with 400 once the purchase is ordered`; `rejects an unknown variant with 404 and leaves the old items untouched`; `unknown purchase id returns 404`.
- [ ] **Step 2: Run to verify they fail.** Run: `yarn test:integration:http purchases.spec.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the step (compensation restores the previous items and costs; non-`draft` throws `NOT_ALLOWED`), the workflow (dismiss old item links with `dismissRemoteLinkStep`, create new ones) and the `POST` route.
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): allow editing a draft purchase`.

---

### Task 6: Place order and cancel

**Files:**
- Create: `src/workflows/{place-purchase-order,cancel-purchase}.ts`; `src/workflows/steps/{place-purchase-order,cancel-purchase}.ts`; `src/api/admin/purchases/[id]/order/route.ts`, `[id]/cancel/route.ts`
- Test: add to `integration-tests/http/purchases.spec.ts`

**Interfaces:**
- Produces: `placePurchaseOrderWorkflow(input: { purchase_id: string })` and `cancelPurchaseWorkflow(input: { purchase_id: string })`, each returning `WorkflowResponse({ purchase })`.

- [ ] **Step 1: Write the failing tests:** `POST /:id/order moves draft to ordered and sets ordered_at`; `order rejects a draft with no items (400)`; `order rejects a purchase that is not draft (400)`; `POST /:id/cancel cancels a draft and an ordered purchase`; `cancel rejects once any quantity_received > 0 (400)` (set `quantity_received` directly through the module service); `cancel rejects a received or already cancelled purchase (400)`; unknown id returns 404.
- [ ] **Step 2: Run to verify they fail.** Run: `yarn test:integration:http purchases.spec.ts`. Expected: new cases FAIL.
- [ ] **Step 3: Implement** the steps (compensation restores the previous status and `ordered_at`), workflows and routes.
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add place order and cancel purchase`.

---

### Task 7: Receive goods

**Files:**
- Create: `src/workflows/receive-purchase-goods.ts`; `src/workflows/steps/{validate-purchase-receipt,record-purchase-receipt}.ts`; `src/api/admin/purchases/[id]/receive/route.ts`
- Modify: `src/api/admin/purchases/middlewares.ts` (add `ReceivePurchaseSchema`)
- Test: add to `integration-tests/http/purchases.spec.ts`

**Interfaces:**
- Consumes: `validateReceiveQuantities`, `getStatusAfterReceipt` (Task 2); core `adjustInventoryLevelsStep`, `createInventoryLevelsStep` from `@medusajs/medusa/core-flows`.
- Produces: `receivePurchaseGoodsWorkflow(input: { purchase_id: string; stock_location_id: string; items: { purchase_item_id: string; quantity: number }[]; note?: string })` returning `WorkflowResponse({ purchase, receipt })`. `validatePurchaseReceiptStep(input)` returns `{ adjustments: { inventory_item_id: string; location_id: string; adjustment: number }[]; missingLevels: { inventory_item_id: string; location_id: string; stocked_quantity: 0 }[] }`.

- [ ] **Step 1: Write the failing tests** (set up a real stock location, a product whose variant has `manage_inventory: true`, and read levels with `inventoryModule.listInventoryLevels`):
  - `partial delivery raises stock by the received quantity, records the receipt, links the receipt to the stock location, sets partially_received`
  - `a second delivery completing the order sets received`
  - `rejects receiving more than the remaining quantity (400), naming the item and the remaining number; stock and records unchanged`
  - `rejects a draft, cancelled or already received purchase (400)`
  - `rejects a variant with manage_inventory false (400) and changes nothing`
  - `rejects a variant with no inventory item (400) and changes nothing`
  - `creates the inventory level when the location has none, ending at the received quantity`
  - `two simultaneous receives that together exceed remaining: exactly one 200 and one 400, stock rises once, quantity_received equals the accepted quantity` (`Promise.all` of two requests)
  - `a failure after the receipt is recorded rolls everything back` (make the stock step throw by passing a `stock_location_id` the inventory module rejects, or spy on `adjustInventory`; assert no receipt rows and `quantity_received` unchanged)
- [ ] **Step 2: Run to verify they fail.** Run: `yarn test:integration:http purchases.spec.ts`. Expected: new cases FAIL.
- [ ] **Step 3: Implement.** `validatePurchaseReceiptStep` loads the purchase and its items, checks status, runs `validateReceiveQuantities`, and reads each variant (`query.graph`, entity `product_variant`, fields `id`, `manage_inventory`, `inventory_items.inventory_item_id`) to build the adjustments, throwing a clear `INVALID_DATA` for a variant with `manage_inventory: false` or no inventory item; it lists missing levels with `inventoryModule.listInventoryLevels`. In the workflow, call `createInventoryLevelsStep` inside `when(...)` only for missing levels, then `recordPurchaseReceiptStep`, then `createRemoteLinkStep` for the receipt-to-stock-location link (`{ purchase: { purchase_receipt_id }, [Modules.STOCK_LOCATION]: { stock_location_id } }`), then `adjustInventoryLevelsStep(adjustments)`. `recordPurchaseReceiptStep` wraps its work in `Modules.LOCKING` `execute(["purchase:" + purchaseId], ...)`, **re-runs `validateReceiveQuantities` against freshly read items inside the lock** (this check, not the earlier one, is the authoritative one), creates the receipt and receipt items, increments each `quantity_received`, sets the status with `getStatusAfterReceipt`; its compensation deletes the receipt and restores the previous quantities and status.
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add receive purchase goods workflow`.

---

### Task 8: Suppliers admin page

**Files:**
- Create: `src/admin/routes/suppliers/page.tsx`
- Test: `src/admin/routes/suppliers/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `GET/POST /admin/suppliers`, `POST/DELETE /admin/suppliers/:id` (Task 3).
- Produces: default-exported `SuppliersPage` and `export const config = defineRouteConfig({ label: "Suppliers" })`.

- [ ] **Step 1: Write the failing tests** mocking the SDK as `src/admin/routes/reviews/__tests__/page.unit.spec.tsx` does: `lists supplier names, emails and phones`; `shows "No suppliers yet." when empty`; `typing in search refetches with q`; `creating a supplier posts the entered fields and shows the new row`; `editing posts the changed fields to /admin/suppliers/:id`; `deleting asks for confirmation and removes the row`; `a refused delete shows the server's message and keeps the row`; `pagination next/prev change the offset`.
- [ ] **Step 2: Run to verify it fails.** Run: `yarn test:unit src/admin/routes/suppliers/__tests__/page.unit.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page in the style of `src/admin/routes/reviews/page.tsx` (Medusa UI `Container`, `Table`, `Drawer` for the create/edit form, `toast` for feedback; `useQuery`/`useMutation` with query invalidation).
- [ ] **Step 4: Run to verify it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add Suppliers admin page`.

---

### Task 9: Purchases list and detail pages

**Files:**
- Create: `src/admin/routes/purchases/page.tsx`, `src/admin/routes/purchases/[id]/page.tsx`
- Test: `src/admin/routes/purchases/__tests__/page.unit.spec.tsx`, `src/admin/routes/purchases/[id]/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `AdminPurchase` shape (Task 4), `POST /:id/order`, `POST /:id/cancel` (Task 6).
- Produces: `PurchasesPage` with `defineRouteConfig({ label: "Purchases" })`; `PurchaseDetailPage`. The detail page renders `<ReceiveGoodsDialog purchase={...} />` from Task 10 only for `ordered` / `partially_received`.

- [ ] **Step 1: Write the failing tests.** List: `shows reference, supplier, status, total and order date`; `status tabs (All, Draft, Ordered, Partly received, Received, Cancelled) refetch with the status filter`; `per-tab empty text`; `a "New purchase" button links to /purchases/new`; `row click opens /purchases/:id`. Detail: `shows items with ordered, received and unit cost, the extra costs, subtotal and total`; `lists each delivery with date, location and quantities`; `draft shows Place order and Cancel, ordered shows Receive goods and Cancel, partly received shows Receive goods only, received and cancelled show none`; `Place order and Cancel call their endpoints and refresh`; `a server error from an action is shown`.
- [ ] **Step 2: Run to verify they fail.** Run: `yarn test:unit src/admin/routes/purchases`. Expected: FAIL.
- [ ] **Step 3: Implement** both pages in the style of the Reviews page; Task 10's dialog is imported behind a stub export so this task compiles (create `components/receive-goods-dialog.tsx` exporting a placeholder component, replaced in Task 11).
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add Purchases list and detail pages`.

---

### Task 10: New purchase page

**Files:**
- Create: `src/admin/routes/purchases/new/page.tsx`
- Test: `src/admin/routes/purchases/new/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `POST /admin/purchases` (Task 4), `GET /admin/suppliers` (Task 3), the core variant search `sdk.admin.productVariant.list({ q, limit })`.
- Produces: `NewPurchasePage` (no `defineRouteConfig`, so no sidebar entry; reached from the list's button).

- [ ] **Step 1: Write the failing tests:** `Save is disabled until a supplier and at least one item with quantity above 0 are set`; `searching variants shows results and adding one creates an item row with quantity and unit cost inputs`; `removing a row works`; `shows live subtotal and total including shipping, tax and other cost`; `Save posts { supplier_id, items, shipping_cost, tax, other_cost, notes } and navigates to the new purchase`; `a server error is shown and the form keeps its values`.
- [ ] **Step 2: Run to verify it fails.** Run: `yarn test:unit src/admin/routes/purchases/new/__tests__/page.unit.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page; compute totals with the same rule as `calculatePurchaseTotals` (import the pure helper from `../../../../modules/purchase/utils` if the admin bundle allows it, otherwise duplicate the three-line sum and say why in a comment).
- [ ] **Step 4: Run to verify it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add New purchase page`.

---

### Task 11: Receive goods dialog

**Files:**
- Modify: `src/admin/routes/purchases/components/receive-goods-dialog.tsx` (replace the Task 9 stub)
- Test: `src/admin/routes/purchases/components/__tests__/receive-goods-dialog.unit.spec.tsx`

**Interfaces:**
- Consumes: `AdminPurchase` (Task 4), `POST /admin/purchases/:id/receive` (Task 7), `sdk.admin.stockLocation.list()`.
- Produces: `ReceiveGoodsDialog(props: { purchase: AdminPurchase; onReceived?: () => void })`.

- [ ] **Step 1: Write the failing tests:** `shows each item with its remaining quantity as the maximum`; `Receive is disabled until a stock location is chosen and at least one quantity is above 0`; `a quantity above remaining shows an error and disables Receive`; `submitting posts { stock_location_id, items } containing only items with quantity above 0`; `success closes the dialog, calls onReceived and refreshes the purchase`; `a server error (for example over-receiving) is shown and the dialog stays open`.
- [ ] **Step 2: Run to verify it fails.** Run: `yarn test:unit src/admin/routes/purchases/components/__tests__/receive-goods-dialog.unit.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the dialog (Medusa UI `FocusModal` or `Drawer`, number inputs with `min=0` and `max=remaining`).
- [ ] **Step 4: Run to verify it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): add receive goods dialog`.

---

### Task 12: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the build.** Run: `yarn build`. Expected: succeeds, no type errors.
- [ ] **Step 2: Run lint.** Run: `yarn lint`. Expected: no errors in any file this plan created or modified (existing unrelated warnings are out of scope).
- [ ] **Step 3: Run every test file this plan added.** Run: `yarn test:unit src/modules/purchase src/api/admin/purchases src/admin/routes/suppliers src/admin/routes/purchases`; `yarn test:integration:modules src/modules/supplier src/modules/purchase`; `yarn test:integration:http suppliers.spec.ts purchases.spec.ts`. Expected: all PASS.
- [ ] **Step 4: Run migrations on the dev database.** Run: `npx medusa db:migrate`. Expected: both modules' tables and the three link tables apply cleanly.
- [ ] **Step 5: Commit (only if Steps 1-2 required fixes)** `fix(backend): address build/lint findings in supplier and purchase modules`.
