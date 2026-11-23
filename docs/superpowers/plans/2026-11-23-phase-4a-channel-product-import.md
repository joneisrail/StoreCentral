# Phase 4a: Channel Product Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner preview a connected WooCommerce or Shopify channel's products against StoreCentral, import the unmatched ones as draft products, and link them, without ever writing to the channel.

**Architecture:** A pure planner groups channel listings against StoreCentral variants. Channel readers gain a catalogue view (title, image, stock, price). An importer in seller-hub creates draft Medusa products through the admin API and writes `seller_hub.channel_listing` rows. Two internal routes expose preview and import; two backend proxy routes and a panel on the sales-channel page call them.

**Tech Stack:** TypeScript, vitest (seller-hub), jest (backend), vitest + testing-library (dashboard), Medusa v2 admin API, pg.

**Spec:** `docs/superpowers/specs/2026-11-23-phase-4a-channel-product-import-design.md`

## Global Constraints

- Matching is exact, trimmed, case-sensitive SKU. No fuzzy matching.
- Imported products have `status: "draft"`. Import and link never call a channel write method.
- Per run cap: 200 listings. Currency: store default only; other currency is skipped and reported.
- Seller-hub tests use the guarded test database only (`TEST_DATABASE_URL` ending `_test`). Never touch the dev database.
- Errors stored in `sync_job.last_error` pass through `sanitizeSyncError`. Never log credentials or response bodies.
- New dashboard text goes in `packages/admin/dashboard/src/i18n/translations/en.json` (and `$schema.json` if the repo keeps one in step).
- Medusa conventions: backend routes validate with zod from `@medusajs/framework/zod`; only GET/POST/DELETE.

## Review Focus

- A channel listing whose SKU is whitespace-padded or differently cased must not match, and must not be created as a duplicate product. Test in Task 1.
- A re-run after a partial failure must not create a second product for a SKU that was already imported. Test in Task 4.
- Import of 300 unmatched listings must process 200 and report the remaining 100 as `deferred`. Test in Task 4.
- Channel unreachable or seller-hub down must show an error in the panel, not an empty table. Test in Task 7.
- A variable product whose variations include one duplicate SKU must skip the whole parent. Test in Task 1.

---

### Task 1: Planner

**Files:**
- Create: `apps/seller-hub/src/sync/channel-import.ts`
- Test: `apps/seller-hub/src/sync/channel-import.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChannelListing = {
    externalId: string; parentExternalId: string | null
    sku: string | null; title: string; parentTitle: string | null
    price: string; stock: number | null; imageUrl: string | null
    currency: string | null
  }
  export type StoreVariant = { variantId: string; productId: string; sku: string }
  export type ImportPlan = {
    matched: ChannelListing[]; unmatched: ChannelListing[]
    duplicates: string[]; noSku: ChannelListing[]
  }
  export const planImport: (channel: ChannelListing[], store: StoreVariant[]) => ImportPlan
  export const IMPORT_RUN_CAP = 200
  ```
- A listing is `matched` when exactly one StoreCentral variant and exactly one channel listing carry its SKU. `duplicates` holds SKUs seen more than once on either side. If any variation of a parent (same `parentExternalId`) is a duplicate or has no SKU, every sibling is removed from `unmatched` and the parent's other SKUs are added to `duplicates`.

- [ ] **Step 1: Write failing tests** named: `matches by exact trimmed sku`, `case differs so unmatched`, `padded sku trimmed on channel side matches`, `duplicate on channel side`, `duplicate on store side`, `no sku listed separately`, `variable parent with one duplicate variation skips all siblings`, `empty inputs`. Assert exact group contents.
- [ ] **Step 2: Run** `cd apps/seller-hub && npx vitest run src/sync/channel-import.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `planImport` per the Interfaces text. Trim SKUs on both sides before grouping.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): channel import planner`.

### Task 2: Channel catalogue readers

**Files:**
- Modify: `apps/seller-hub/src/woocommerce/products.ts`, `apps/seller-hub/src/shopify/products.ts`
- Test: extend `woocommerce/products.test.ts`, `shopify/products.test.ts`

**Interfaces:**
- Consumes: `ChannelListing` from Task 1 (import type only).
- Produces:
  ```ts
  export const listWooCatalog: (client: WooCommerceClient) => Promise<ChannelListing[]>
  export const listShopifyCatalog: (client: ShopifyClient) => Promise<ChannelListing[]>
  ```
  Existing `listWooListings` and `listShopifyVariants` stay unchanged (the link flow uses them).
- Woo: simple products and variations of variable products, SKU may be null (kept, unlike `listWooListings`). Fields come from `name`, `images[0].src`, `stock_quantity` (null if not managed), `regular_price || price`. A variation with the parent's own SKU gets `sku: null`. Currency is not in the product payload: set `currency: null` (the store setting check is Task 4).
- Shopify: extend the GraphQL query for a new `CATALOG_QUERY` with `product { title featuredImage { url } }`, variant `title`, `inventoryQuantity`; `sku` null when blank; `parentExternalId` is the product id, `parentTitle` its title; `currency: null`.

- [ ] **Step 1: Write failing tests** with the existing fake clients in those test files: Woo (`simple with sku`, `simple without sku is kept with sku null`, `variation inheriting parent sku gets null`, `unmanaged stock is null`) and Shopify (`maps title image stock`, `blank sku becomes null`, `paginates`).
- [ ] **Step 2: Run both files.** Expected: FAIL.
- [ ] **Step 3: Implement** the two readers, reusing `fetchAll` and the pagination loop already in each file.
- [ ] **Step 4: Run both files.** Expected: PASS, existing tests still green.
- [ ] **Step 5: Commit** `feat(seller-hub): channel catalogue readers`.

### Task 3: Medusa client product creation

**Files:**
- Modify: `apps/seller-hub/src/medusa/admin-client.ts`, `apps/seller-hub/src/test-support/fake-medusa.ts`
- Test: extend `apps/seller-hub/src/medusa/admin-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CreateDraftProductInput = {
    title: string; sku: string; price: number; currencyCode: string
    imageUrl: string | null; initialStock: number | null
    options?: { name: string; value: string }[]
  }
  // on MedusaAdminClient:
  createDraftProduct(input: CreateDraftProductInput): Promise<{ productId: string; variantId: string }>
  getDefaultCurrency(): Promise<string>
  ```
- Behaviour: `POST /admin/products` with `status: "draft"`, one option `Default` (or the given `options`), one variant with the SKU and a price in `currencyCode` (prices are stored as given, never multiplied by 100), `thumbnail`/`images` from `imageUrl` when set. When `initialStock` is a number, resolve the variant's inventory item and the first stock location (`GET /admin/stock-locations?limit=1`) and `POST /admin/inventory-items/:id/location-levels` with `{ location_id, stocked_quantity }`. `getDefaultCurrency` reads `GET /admin/stores` (the fake already serves it).
- **Spike inside this task:** before coding, confirm the three request shapes against the installed Medusa 2.21.2 route validators (`packages/medusa/src/api/admin/products/validators.ts`, `inventory-items/validators.ts`) and record the confirmed field names in the test comments. If the stock endpoints differ, adapt; do not guess.

- [ ] **Step 1: Extend the fake** with `POST /admin/products` (records the body, appends a variant to `state.variants`, returns `{ product: { id, variants: [{ id }] } }`), `GET /admin/stock-locations`, and `POST /admin/inventory-items/:id/location-levels` (records body). Add `createdProducts` and `locationLevels` arrays to state.
- [ ] **Step 2: Write failing tests**: `creates a draft product with price as given`, `sets initial stock at the first location`, `skips stock when initialStock is null`, `throws a sanitized error on 400`.
- [ ] **Step 3: Run** `npx vitest run src/medusa/admin-client.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** both methods with the existing `authedFetch` and `sanitizeSyncError`.
- [ ] **Step 5: Run the file.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(seller-hub): create draft products through the admin API`.

### Task 4: Importer

**Files:**
- Create: `apps/seller-hub/src/sync/channel-import-run.ts`
- Test: `apps/seller-hub/src/sync/channel-import-run.test.ts`

**Interfaces:**
- Consumes: `planImport`, `IMPORT_RUN_CAP`, `ChannelListing`; `MedusaAdminClient.createDraftProduct/getDefaultCurrency/listVariantsBySku`.
- Produces:
  ```ts
  export type ImportPreview = ImportPlan
  export type ImportOutcome = {
    imported: string[]; failed: { sku: string; message: string }[]
    skipped: { sku: string; reason: "already_linked" | "currency" }[]
    deferred: string[]
  }
  export const previewImport: (deps: { channel: () => Promise<ChannelListing[]>; medusaClient: MedusaAdminClient }) => Promise<ImportPreview>
  export const runImport: (deps: {
    pool: Pool; medusaClient: MedusaAdminClient; integrationAccountId: string
    channel: () => Promise<ChannelListing[]>; skus: string[] | "all"
  }) => Promise<ImportOutcome>
  ```
- Behaviour: `runImport` re-reads the channel and store (never trusts the caller's SKU list beyond selecting from it), plans, takes the selected unmatched listings, processes at most `IMPORT_RUN_CAP`, returns the rest in `deferred`. Per listing: create draft product, then insert `seller_hub.channel_listing` using the same INSERT as `sync/woocommerce-link.ts` (`ON CONFLICT (integration_account_id, external_sku) DO NOTHING`; for Shopify the columns follow `sync/shopify-link.ts`: read that file and mirror its insert exactly). A failure records a failed `sync_job` (`sync_type='product'`, `external_id=sku`, sanitized message) and continues. A SKU that already has a `channel_listing` row is `skipped: already_linked` without creating a product. Parent grouping: listings sharing a `parentExternalId` become variants of one product when the channel gave options; since Task 3 creates one variant per product, **ruling: each listing becomes its own draft product** (title = `parentTitle` + variant title when both exist). Grouping into multi-variant products is deferred; record it in the ledger.

- [ ] **Step 1: Write failing tests** (guarded test DB, fake Medusa, fake channel function): `preview groups without writing`, `creates draft product and link row`, `idempotent second run skips linked`, `partial failure records sync_job and continues`, `cap of 200 defers the rest` (300 listings), `other currency skipped`, `never calls a channel write` (channel is a read-only function, assert it is called only for reading), `selected skus only`.
- [ ] **Step 2: Run the file.** Expected: FAIL.
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): preview and run channel product import`.

### Task 5: Runtime and internal routes

**Files:**
- Modify: `apps/seller-hub/src/woocommerce/bootstrap.ts`, `apps/seller-hub/src/shopify/bootstrap.ts`, `apps/seller-hub/src/internal/connections.ts`
- Test: extend `apps/seller-hub/src/internal/connections.test.ts`

**Interfaces:**
- Consumes: `previewImport`, `runImport`, `listWooCatalog`, `listShopifyCatalog`.
- Produces on both runtimes: `previewImport(): Promise<ImportPreview>` and `importListings(skus: string[] | "all"): Promise<ImportOutcome>` next to `relink`.
- Routes (secret protected, same `UUID` check, `409 not_running` when the connection has no live runtime as `link` does):
  - `GET /internal/connections/:id/import-preview` returns `{ matched, unmatched, duplicates, no_sku }` with `matched` reduced to `{ sku, title }` and the others to `{ sku, title, price, stock, image_url }` (`duplicates` as SKU strings).
  - `POST /internal/connections/:id/import` with body `{ skus: string[] | "all" }` returns `{ imported, failed, skipped, deferred }` (counts and lists). Invalid body: 400 `invalid_json`.
  - Amazon connections: 400 `unsupported_marketplace`.

- [ ] **Step 1: Write failing tests** with the existing fake runtime in `connections.test.ts`: `preview 401 without secret`, `preview 409 when not running`, `preview returns the four groups`, `import validates body`, `import passes skus and returns outcome`, `amazon is rejected`.
- [ ] **Step 2: Run** `npx vitest run src/internal/connections.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: add the runtime methods in both bootstraps (the clients and `pool` are already in scope where `runLink` is defined), extend the action whitelist in `route`, add the two handlers.
- [ ] **Step 4: Run the file plus `npx vitest run src/woocommerce src/shopify`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): internal import-preview and import routes`.

### Task 6: Backend proxy routes

**Files:**
- Create: `apps/backend/src/api/admin/marketplace-connections/[id]/import-preview/route.ts`, `.../[id]/import/route.ts`
- Modify: `apps/backend/src/api/admin/marketplace-connections/middlewares.ts`, `.../respond.ts` only if `connectionPath` cannot take the new action names
- Test: extend `apps/backend/src/api/admin/marketplace-connections/__tests__/routes.unit.spec.ts`

**Interfaces:**
- Consumes: `callSellerHub`, `connectionPath`, `respond` (as in `[id]/link/route.ts`).
- Produces: `GET /admin/marketplace-connections/:id/import-preview` (timeout 120 000 ms) and `POST /admin/marketplace-connections/:id/import` (timeout 300 000 ms); body schema `ImportSchema = z.strictObject({ skus: z.union([z.literal("all"), z.array(z.string().trim().min(1).max(255)).max(500)]) })` exported with its inferred type, registered in middlewares for `POST /admin/marketplace-connections/:id/import`.

- [ ] **Step 1: Write failing tests** mirroring the existing link-route tests: path, method, timeout, body forwarded, schema rejects unknown keys and a 501-item list, seller-hub error passed through `respond`.
- [ ] **Step 2: Run** `cd apps/backend && npx jest --config jest.config.js apps/backend/src/api/admin/marketplace-connections --runInBand` (use the unit-test command from `apps/backend/package.json`). Expected: FAIL.
- [ ] **Step 3: Implement** the routes and schema.
- [ ] **Step 4: Run the tests and `npx tsc --noEmit -p apps/backend`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): proxy channel import routes to seller-hub`.

### Task 7: Dashboard panel

**Files:**
- Modify: `packages/admin/dashboard/src/hooks/api/marketplace-connections.tsx`, `.../sales-channel-marketplace-section/sales-channel-marketplace-section.tsx`, `packages/admin/dashboard/src/i18n/translations/en.json`
- Create: `packages/admin/dashboard/src/routes/sales-channels/sales-channel-detail/components/channel-import-panel/channel-import-panel.tsx`, `.../__tests__/channel-import-panel.spec.tsx`

**Interfaces:**
- Hooks: `useImportPreview(connectionId, { enabled })` (GET, via `sdk.client.fetch`, never plain fetch) and `useRunImport(connectionId)` (mutation POST `{ skus }`, invalidates the preview query).
- `ChannelImportPanel({ connectionId })`: shows a "Check products" button; after the preview loads shows four groups with counts (matched, to import, duplicates, no SKU), a table of the "to import" listings with checkboxes and an "Import selected" button (disabled with none selected; "Import all" when the owner chooses it), then the outcome counts (imported, failed with messages, skipped, deferred). Shown only for Shopify and WooCommerce connections. Error state: a visible alert with the returned message and a retry button.

- [ ] **Step 1: Write failing specs** (testing-library, mocked hooks, following `sales-channel-marketplace-section.spec.tsx`): `shows four counts after preview`, `import selected sends chosen skus`, `import all sends "all"`, `shows error and retry when preview fails`, `hidden for amazon`, `shows deferred count after a capped run`.
- [ ] **Step 2: Run** `cd packages/admin/dashboard && npx vitest run src/routes/sales-channels/sales-channel-detail/components/channel-import-panel`. Expected: FAIL.
- [ ] **Step 3: Implement** hooks, panel, mount it in the marketplace section, add the strings.
- [ ] **Step 4: Run the new spec, the marketplace section specs, and `npx eslint` on the changed files.** Expected: PASS, 0 lint errors.
- [ ] **Step 5: Commit** `feat(dashboard): channel product import panel`.

### Task 8: End-to-end check and docs

**Files:**
- Create: `apps/seller-hub/src/sync/channel-import.e2e.test.ts`
- Modify: `docs/ops/runbook.md` (short "Importing a channel's products" section), `docs/README.md` only if it indexes runbook sections

- [ ] **Step 1: Write the e2e test** with the fake Medusa and a fake WooCommerce server (pattern in `woocommerce-sync.e2e.test.ts`): preview, import selected, second preview shows them matched, and the fake WooCommerce received zero non-GET requests.
- [ ] **Step 2: Run it.** Expected: PASS.
- [ ] **Step 3: Run the full suites that changed**: `apps/seller-hub` (`npx vitest run`), backend unit specs, dashboard spec directory for sales-channels, root lint for changed files. Expected: green, no new failures against the baseline listed in `deploy/ci-watchlist.md`.
- [ ] **Step 4: Write the runbook section** (what the panel does, drafts are never published, the 200 cap, how to read failures in `seller_hub.sync_job`).
- [ ] **Step 5: Commit** `test(seller-hub): channel import end to end; docs: runbook section`.
