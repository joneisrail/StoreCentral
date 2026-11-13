# Shopify Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep stock and price in sync between StoreCentral (master) and Shopify, and import Shopify orders, as a second marketplace inside `apps/seller-hub`.

**Architecture:** A new `shopify/` folder (GraphQL client, product/inventory/order helpers, webhook HMAC) beside `sp-api/`, new `shopify-*` sync modules beside the Amazon ones, new `shopify-*` BullMQ queues, and additive schema columns. Everything reuses the existing Pool, Medusa admin client, `sync_job` tracking, queue helpers and reconciliation. Shopify is optional: with no Shopify config seller-hub boots exactly as today.

**Tech Stack:** Node 20 + TypeScript (ESM, `.js` import suffixes), BullMQ, pg, vitest, Shopify Admin GraphQL API, Medusa v2 Admin API.

**Spec:** `docs/superpowers/specs/2026-11-13-shopify-sync-design.md`

## Global Constraints

All paths are under `apps/seller-hub` unless stated. Tests: `yarn workspace @dtc/seller-hub test` (vitest run; run a single file with `npx vitest run <path>` from `apps/seller-hub`); types: `yarn workspace @dtc/seller-hub build` (tsc).

- The Amazon sync must keep working unchanged: every existing test stays green, and existing exported signatures keep their meaning. `SellerHubEnv` / `loadEnv` stay as they are (Shopify config is read by a separate loader and is optional).
- Schema changes are additive and idempotent in `src/db/schema.ts` (`ADD COLUMN IF NOT EXISTS`, same style as the existing file); migrations run on boot through `runMigrations`.
- Reuse, do not duplicate: `claimOrderSyncJob`, `markSyncJobFailed`, `markSyncJobSucceeded`, `PermanentSyncError`, `DeferSyncError`, `createSyncQueue`, `createSyncWorker`, `MedusaAdminClient`, `crypto/secret-box.ts` (`encrypt`, `decrypt`), `resolveInventoryChannelListingId` / `resolvePriceChannelListingId` (they are keyed by `integrationAccountId`, so they serve the Shopify account unchanged).
- Failure classification as for Amazon: a 4xx from Shopify (except 429) or from Medusa is `PermanentSyncError`; 429 and 5xx and network errors retry; Shopify throttling honours the retry hint. A Shopify outage must never throw into the Medusa webhook path.
- Tests never call real Shopify: use an injectable `fetchImpl` and a fake GraphQL server/stub. Money from Shopify is a decimal string in dollars; keep USD only.
- Shopify credentials come from env (`SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_LOCATION_ID`) and the token is stored encrypted in `integration_account.access_token_encrypted`. Never log tokens or the webhook secret.
- Run the Medusa backend side (Task 8's script) only as a file; do NOT execute it against the dev database. Do not push. Commit after each task.

## Review Focus

- A redelivered or retried Shopify order never produces a second order (Task 6).
- A forged or altered webhook body is rejected before anything is queued (Task 5).
- A Shopify outage or missing Shopify config never breaks Medusa events or the Amazon sync (Tasks 1, 5, 8).
- An unmatched or duplicate SKU never creates a wrong link or a partial order (Tasks 3, 6).
- Drift correction only changes the Shopify side and cannot loop push -> event -> push (Task 7).

---

### Task 1: Foundation — schema, Shopify config loader, account row, queue names

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/shopify/config.ts`
- Create: `src/shopify/account.ts`
- Modify: `src/queue/queues.ts` (queue name union only)
- Test: `src/db/migrate.test.ts` (extend if it asserts columns), `src/shopify/config.test.ts`, `src/shopify/account.test.ts`

**Interfaces:**
- Produces:
  - `export type ShopifyConfig = { shopDomain: string; accessToken: string; webhookSecret: string; locationId: string }`
  - `export const loadShopifyConfig = (env?: NodeJS.ProcessEnv): ShopifyConfig | null` — `null` when any of the four variables is missing or empty (never throws).
  - `export const resolveShopifyAccount = async (pool: Pool, config: ShopifyConfig, encryptionKey: string): Promise<{ id: string; shopDomain: string; locationId: string }>` — finds or creates the single `integration_account` row with `marketplace = 'shopify'`, stores `shop_domain`, `shopify_location_id` and `access_token_encrypted` (via `encrypt`), sets `status = 'connected'`; idempotent (re-running updates the same row).
  - `SyncQueueName` gains `"shopify-inventory-sync" | "shopify-price-sync" | "shopify-order-sync"`.
  - Schema: `integration_account` gains `shop_domain TEXT`, `access_token_encrypted TEXT`, `shopify_location_id TEXT`; `channel_listing` gains `external_variant_id TEXT`, `external_inventory_item_id TEXT`.

- [ ] **Step 1: Write failing tests:** `loadShopifyConfig` returns the config when all four are set, `null` when any is missing/empty (one case per variable); `resolveShopifyAccount` creates one row, a second call returns the same id and does not store the plaintext token (stored value differs from the token and `decrypt` round-trips); the schema SQL contains the five new columns and is safe to run twice (follow the existing `migrate.test.ts` style).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the schema additions, `loadShopifyConfig` and `resolveShopifyAccount`, and extend `SyncQueueName`.
- [ ] **Step 4: Run** the new tests and the full seller-hub suite (all green), plus `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): add Shopify config, account row and schema columns`.

---

### Task 2: Shopify GraphQL client and helpers

**Files:**
- Create: `src/shopify/client.ts`, `src/shopify/products.ts`, `src/shopify/inventory.ts`, `src/shopify/orders.ts`
- Test: matching `*.test.ts` files beside each, using an injected `fetchImpl`.

**Interfaces:**
- Produces:
  - `export class ShopifyClient { constructor(config: { shopDomain: string; accessToken: string; apiVersion?: string; fetchImpl?: typeof fetch }); graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> }` — POST `https://{shopDomain}/admin/api/{apiVersion}/graphql.json` with `X-Shopify-Access-Token`; default `apiVersion` is a fixed pinned constant; throws `PermanentSyncError` on 4xx except 429 and on GraphQL `errors` that are user errors (e.g. access denied); on HTTP 429 or a GraphQL `THROTTLED` error it waits the throttle hint (injectable `sleep` for tests, bounded retries) then retries; 5xx and network errors are rethrown as plain `Error`.
  - `products.ts`: `listShopifyVariants(client): Promise<{ variantId: string; sku: string | null; inventoryItemId: string; price: string }[]>` (paginated by cursor), `updateShopifyVariantPrice(client, { productId?: string; variantId: string; price: string }): Promise<void>` (uses `productVariantsBulkUpdate`; surfaces `userErrors` as `PermanentSyncError`).
  - `inventory.ts`: `setShopifyAvailable(client, { inventoryItemId: string; locationId: string; quantity: number }): Promise<void>` (`inventorySetQuantities`, name `available`, reason `correction`; quantity clamped to `>= 0`, integer).
  - `orders.ts`: `NormalizedShopifyOrder = { shopifyOrderId: string; orderName: string; financialStatus: string; cancelledAt: string | null; buyerEmail: string; items: { sku: string; quantity: number; unitPrice: number }[]; shippingAddress: { first_name; last_name; address_1; city; country_code; postal_code } }`, `normalizeShopifyOrder(raw: unknown): NormalizedShopifyOrder` (throws `PermanentSyncError` on a malformed order; line items without a SKU are kept with `sku: ""` so the importer can fail them cleanly; taxes and shipping lines are NOT items; `unitPrice` is the line's discounted unit price as a number), and `fetchShopifyOrdersSince(client, sinceIso: string): Promise<NormalizedShopifyOrder[]>` (paginated, `updated_at:>=`).

- [ ] **Step 1: Write failing tests** with a stub `fetchImpl` returning canned GraphQL responses: auth header and URL; pagination of `listShopifyVariants` across two pages; `THROTTLED` then success retries once; 401/403 -> `PermanentSyncError`; 500 -> plain `Error`; `userErrors` -> `PermanentSyncError`; `setShopifyAvailable` clamps `-3` to `0` and sends the mapped location; price update sends the string price; `normalizeShopifyOrder` happy path, missing-SKU line, shipping/tax excluded, malformed order throws.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the four modules (small, one responsibility each).
- [ ] **Step 4: Run** the new tests and the full suite and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): add the Shopify GraphQL client and helpers`.

---

### Task 3: Link Shopify variants to StoreCentral variants by SKU

**Files:**
- Create: `src/sync/shopify-link.ts`
- Test: `src/sync/shopify-link.test.ts`

**Interfaces:**
- Consumes: `ShopifyClient`/`listShopifyVariants` (Task 2), the Shopify account (Task 1), and `MedusaAdminClient` (add `listVariantsBySku()` if no suitable method exists: `Promise<{ variantId: string; productId: string; sku: string }[]>`, paginated over `/admin/product-variants`).
- Produces: `export const linkShopifyVariants = async (deps: { pool: Pool; medusaClient: MedusaAdminClient; shopifyClient: ShopifyClient; integrationAccountId: string }): Promise<{ linked: number; alreadyLinked: number; unmatched: string[]; duplicates: string[] }>`.

- [ ] **Step 1: Write failing tests:** matching SKUs create `channel_listing` rows (`external_sku`, `external_variant_id`, `external_inventory_item_id`, `medusa_variant_id`, `medusa_product_id`, status `published`); a second run adds nothing (`alreadyLinked`); a Shopify SKU with no StoreCentral match is returned in `unmatched` and no row is written; a SKU that appears twice on either side is returned in `duplicates` and no row is written; blank/null Shopify SKUs are ignored; SKU comparison is case-sensitive exact after trimming. Unmatched/duplicate cases are also recorded on `seller_hub.sync_job` (`sync_type 'product'`, `external_id` = the SKU, `last_error` set).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `linkShopifyVariants`; insert with `ON CONFLICT (integration_account_id, external_sku) DO NOTHING`.
- [ ] **Step 4: Run** the new tests, the full suite and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): link Shopify variants to StoreCentral variants by SKU`.

---

### Task 4: Push stock and price to Shopify

**Files:**
- Create: `src/sync/shopify-push-inventory.ts`, `src/sync/shopify-push-price.ts`
- Test: `src/sync/shopify-push-inventory.test.ts`, `src/sync/shopify-push-price.test.ts`

**Interfaces:**
- Consumes: `channel_listing` rows (Task 3), `setShopifyAvailable` and `updateShopifyVariantPrice` (Task 2), `MedusaAdminClient` current inventory/price getters used by `push-inventory.ts` / `push-price.ts` (read those two files and mirror their claim/tracking/error conventions).
- Produces: `pushShopifyInventory(deps: { pool; medusaClient; shopifyClient; integrationAccountId; locationId: string; channelListingId: string }): Promise<void>` and `pushShopifyPrice(deps: { pool; medusaClient; shopifyClient; integrationAccountId; channelListingId: string }): Promise<void>`. On success they set `last_synced_quantity` / `last_synced_price` and mark the `sync_job` succeeded; on failure they record `last_error` on the job and rethrow classified errors (permanent vs retryable).

- [ ] **Step 1: Write failing tests** mirroring `push-inventory.test.ts` / `push-price.test.ts`: the pushed quantity equals StoreCentral's available quantity and is clamped at 0; `last_synced_quantity` is updated on success only; a Shopify 4xx makes a `PermanentSyncError` and records `last_error`; a 5xx rethrows retryable; price is pushed as a 2-decimal USD string; a non-USD Medusa price is a permanent failure (nothing pushed); a listing that does not belong to the account is a permanent failure.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the two push functions.
- [ ] **Step 4: Run** the new tests, the full suite and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): push stock and price to Shopify`.

---

### Task 5: Webhook — HMAC verification, Shopify route, Medusa event fan-out

**Files:**
- Create: `src/shopify/webhook.ts`
- Modify: `src/webhook/server.ts`
- Test: `src/shopify/webhook.test.ts`, `src/webhook/server.test.ts` (extend)

**Interfaces:**
- Produces:
  - `export const verifyShopifyHmac = (rawBody: string | Buffer, headerValue: string | undefined, secret: string): boolean` — base64 HMAC-SHA256 of the raw body, constant-time comparison; false for a missing or malformed header.
  - `createWebhookServer` deps gain optional `shopify?: { webhookSecret: string; orderQueue: Queue; inventoryQueue: Queue; priceQueue: Queue }`. With it present: `POST /webhooks/shopify` verifies `X-Shopify-Hmac-Sha256` over the raw body and responds 401 on mismatch **before parsing or queueing anything**; topics `orders/create`, `orders/updated`-style `orders/paid` and `orders/cancelled` (header `X-Shopify-Topic`) enqueue `{ shopifyOrderId }` on `orderQueue` (job id = the order id so duplicates collapse); other topics are acknowledged and ignored. Each Medusa event received on `/webhooks/medusa` is additionally enqueued to the Shopify inventory/price queues (`{ inventoryLevelId }` / `{ variantId }`), in addition to, and independent of, the Amazon enqueue; a failure enqueueing to Shopify is logged and never changes the response or blocks the Amazon enqueue.

- [ ] **Step 1: Write failing tests:** `verifyShopifyHmac` valid; altered body; wrong secret; missing header; header of the wrong length (no throw); `/webhooks/shopify` with a bad signature returns 401 and queues nothing (assert queues untouched); valid `orders/create` queues one job with the order id and responds 200; the same delivery twice queues one job; an unknown topic returns 200 and queues nothing; Medusa `inventory-level.updated` enqueues to both the Amazon and Shopify inventory queues; with `shopify` deps absent the server behaves exactly as before; a rejecting Shopify queue does not stop the Amazon enqueue or change the 200.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** both pieces. Read the request body as raw bytes before any JSON parsing for the Shopify route.
- [ ] **Step 4: Run** the new tests, the full suite and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): receive Shopify webhooks and fan Medusa events out to Shopify`.

---

### Task 6: Import Shopify orders

**Files:**
- Create: `src/sync/shopify-import-order.ts`, `src/sync/shopify-order-sync-processor.ts`
- Modify (only if needed, minimally): `src/sync/import-order.ts`
- Test: `src/sync/shopify-import-order.test.ts`, `src/sync/shopify-order-sync-processor.test.ts`

**Interfaces:**
- Consumes: `NormalizedShopifyOrder` / `fetchOrder` (Task 2), `claimOrderSyncJob`, `markSyncJob*`, `MedusaAdminClient` (`findOrderByMetadata`, `createDraftOrder`, `convertDraftOrderToOrder`, `findSalesChannelIdByName`), linked `channel_listing` rows (Task 3).
- Produces: `export type ShopifyOrderSyncJobData = { shopifyOrderId: string }` and `processShopifyOrderSyncJob(data, deps: { pool; medusaClient; integrationAccountId; resolveSalesChannelId: () => Promise<string | null>; fetchOrder: (shopifyOrderId: string) => Promise<NormalizedShopifyOrder>; staleProcessingMs?: number }): Promise<{ status: "created" | "recovered" | "skipped"; medusaOrderId?: string; reason?: string }>`.
- Approach: the Amazon claimed-import flow in `import-order.ts` already implements the claim, lease renewal, draft-order recovery and failure recording. Prefer parameterising that flow (metadata key `shopify_order_id` instead of `amazon_order_id`, SKU -> variant via the Shopify account's `channel_listing`) over copying it; every existing `import-order.test.ts` and `order-sync-processor.test.ts` must pass **unchanged**. If parameterising cannot be done without changing Amazon behaviour, write a Shopify-specific flow reusing `claimOrderSyncJob` and the same conventions, and report why.

- [ ] **Step 1: Write failing tests:** a paid order creates one order in the Shopify sales channel with Shopify unit prices (metadata `shopify_order_id`); importing the same order twice (sequentially and with a concurrent claim) yields one order and the second result is `skipped`/`recovered`; a cancelled order (`cancelledAt` set) is skipped; a `pending` financial status is deferred (`DeferSyncError`) and a later paid one imports; a line whose SKU has no link fails the whole import with `PermanentSyncError`, records `last_error`, and creates no draft/order (no partial order); a missing Shopify sales channel is a retryable error; a Medusa 4xx is permanent; the sync job row ends `succeeded` with `medusa_entity_id` on success.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** per the approach above.
- [ ] **Step 4: Run** the new tests, the existing Amazon import tests (unchanged), the full suite and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): import Shopify orders into the Shopify sales channel`.

---

### Task 7: Reconciliation for Shopify (drift and missed orders)

**Files:**
- Modify: `src/sync/reconcile.ts`
- Test: `src/sync/reconcile.test.ts` (extend; existing cases unchanged)

**Interfaces:**
- Consumes: Shopify `channel_listing` rows with `last_synced_quantity` / `last_synced_price`, `fetchShopifyOrdersSince` (Task 2), the Shopify queues.
- Produces: `reconcileShopify(deps: { pool; medusaClient; integrationAccountId: string; inventoryQueue: Queue; priceQueue: Queue; orderQueue: Queue; fetchOrdersSince: (sinceIso: string) => Promise<{ shopifyOrderId: string }[]> }): Promise<{ inventoryRequeued: number; priceRequeued: number; ordersRequeued: number }>` and a scheduling hook so the existing hourly schedule also runs it when Shopify is configured (keep `scheduleReconciliation`'s current signature working for Amazon; extend by an optional argument).
- Rules: for each listing, if StoreCentral's current available quantity or USD price differs from `last_synced_*`, enqueue a corrective job on the Shopify queues (`{ channelListingId }`); it never writes to Medusa and never calls Shopify itself; it fetches Shopify orders updated since the account's `last_synced_at` (or the last 24 hours when null) and enqueues each order id once (job id = order id); one listing's failure is isolated and does not stop the scan; `last_synced_at` is advanced only after a clean scan.

- [ ] **Step 1: Write failing tests:** quantity drift requeues one inventory job; price drift requeues one price job; no drift requeues nothing; a missed order is enqueued once and an already-imported order id is still enqueued but collapses (assert job id); a failing listing does not stop the others and `last_synced_at` does not advance when any listing failed; the function never calls the Medusa write methods or Shopify mutations (assert via stubs); two consecutive runs with no changes enqueue nothing the second time (no loop).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `reconcileShopify` and the optional schedule hook.
- [ ] **Step 4: Run** the new tests, the existing reconcile tests, the full suite and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): reconcile Shopify stock, price and missed orders`.

---

### Task 8: Bootstrap wiring, backend setup script, docs, end-to-end test

**Files:**
- Modify: `src/index.ts`
- Create: `src/shopify/shopify-sync.e2e.test.ts` (fake Shopify server end to end)
- Create: `apps/backend/src/scripts/setup-shopify-channel.ts`
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: when `loadShopifyConfig()` returns a config, `main()` additionally resolves the Shopify account, builds `ShopifyClient`, runs `linkShopifyVariants` once at boot (log-only on failure), creates the three `shopify-*` queues and workers (inventory via `resolveInventoryChannelListingId` -> `pushShopifyInventory`; price via `resolvePriceChannelListingId` -> `pushShopifyPrice`; order via `processShopifyOrderSyncJob`, resolving the sales channel named `"Shopify"`), passes the `shopify` deps to `createWebhookServer`, and schedules `reconcileShopify`. When it returns `null`, boot is identical to today and one log line says Shopify is skipped.
- `setup-shopify-channel.ts` (run with `npx medusa exec ./src/scripts/setup-shopify-channel.ts`) mirrors `setup-amazon-channel.ts`: ensures a sales channel named `Shopify` exists, links it to the existing stock location(s) and to every product, safe to re-run.

- [ ] **Step 1: Write the failing end-to-end test** using a fake Shopify GraphQL server (in-process `http` server or injected `fetchImpl`), a fake Medusa admin client and an in-memory or test Postgres in the style the existing tests use: variants link by SKU; a signed `orders/create` webhook produces exactly one Medusa order and a duplicate delivery produces none; a Medusa inventory-level event results in one `inventorySetQuantities` call with the available quantity; a Medusa price event results in one price update; a forged webhook is rejected and nothing changes; with Shopify config missing the bootstrap function used by the test starts no Shopify queues.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** the `index.ts` wiring (factor the Shopify bootstrap into a function that the e2e test can call), the backend script, the README section (env variables, Shopify custom-app scopes: read/write products, inventory, orders; the public-URL prerequisite; stock/price master note; how to run the setup script) and `.env.example` entries.
- [ ] **Step 4: Run** the e2e test, the full seller-hub suite, `yarn workspace @dtc/seller-hub build`, and `npx medusa lint` / backend build for the new script (from `apps/backend`). Do NOT execute the setup script against the dev database.
- [ ] **Step 5: Commit** `feat(seller-hub): wire Shopify sync into the service and add the Shopify channel setup script`.
