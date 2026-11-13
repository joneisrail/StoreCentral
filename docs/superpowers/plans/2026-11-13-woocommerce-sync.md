# WooCommerce (WordPress) Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep stock and price in sync between StoreCentral (master) and the WooCommerce store at ai-fragrance.com, and import WooCommerce orders, as a third marketplace inside `apps/seller-hub`.

**Architecture:** A new `woocommerce/` folder (REST client, product/order helpers, signature check, optional bootstrap) beside `shopify/` and `sp-api/`, new `woocommerce-*` sync modules beside the Shopify ones, new `woocommerce-*` BullMQ queues, additive schema columns. Reuse the Pool, Medusa admin client, `sync_job` tracking, queue helpers, the generic `OrderImportAdapter` import flow and the reconcile logic. WooCommerce is optional: with no config seller-hub boots exactly as today.

**Tech Stack:** Node 20 + TypeScript (ESM, `.js` import suffixes), BullMQ, pg, vitest, WooCommerce REST API v3 (`/wp-json/wc/v3`), Medusa v2 Admin API.

**Spec:** `docs/superpowers/specs/2026-11-13-woocommerce-sync-design.md`

## Global Constraints

All paths are under `apps/seller-hub` unless stated. Tests: `yarn workspace @dtc/seller-hub test` (vitest run; one file with `npx vitest run <path>` from `apps/seller-hub`); types: `yarn workspace @dtc/seller-hub build` (tsc). A few existing tests need the live backend/Redis/DB and can flake (`admin-client.test.ts` getVariantPricing, `queues.test.ts`, files sharing the DB): re-run once and note it.

- Amazon and Shopify must keep working unchanged: every existing test stays green, existing exported signatures keep their meaning, and the Amazon `reconcile`, `reconcileShopify`, `import-order.ts` flow behaviour and `shopify-*` modules are not changed in behaviour. `SellerHubEnv` / `loadEnv` stay as they are (WooCommerce config has its own optional loader).
- Schema changes are additive and idempotent in `src/db/schema.ts` (`ADD COLUMN IF NOT EXISTS`).
- Reuse, do not duplicate: `claimOrderSyncJob`, `importClaimedOrder` + `OrderImportAdapter`, `markSyncJobFailed/Succeeded`, `PermanentSyncError`, `DeferSyncError`, `createSyncQueue`, `createSyncWorker`, `MedusaAdminClient`, `crypto/secret-box.ts`, `resolveInventoryChannelListingId` / `resolvePriceChannelListingId`, `applyPriceRule`, the reconcile logic (extract a shared function only if Shopify's behaviour and tests stay unchanged; otherwise write a WooCommerce twin and note the duplication).
- Lessons already learned on Shopify, apply from the start: (1) BullMQ rejects integer job ids: order job id is `woocommerce-order-<id>` with `removeOnComplete: true, removeOnFail: true`; (2) the optional startup is wrapped so a failure is logged (message only) and the service continues; (3) the reconcile job runs on the WooCommerce inventory queue only and is routed by job name there; (4) a NULL `last_synced_*` baseline counts as drift; the order watermark advances whenever the order catch-up succeeded; (5) order SKUs are trimmed in the normalizer; (6) the drift price comparison applies the listing's `price_rule` with `applyPriceRule`; (7) write the failing test first and show RED before implementing.
- Failure classification: a 4xx from WooCommerce (except 429) or from Medusa is `PermanentSyncError`; 429, 5xx and network errors retry; a WooCommerce outage never throws into the Medusa webhook path.
- Credentials: site URL must be `https://` (reject otherwise at load time); the consumer secret is stored encrypted (`integration_account.access_token_encrypted`), the consumer key in `integration_account.api_key`, the site URL in `integration_account.shop_domain`; keys, secrets and bodies are never logged. WooCommerce money is a decimal string in dollars, USD only.
- Tests never call real services: inject `fetchImpl`; never touch ai-fragrance.com, the dev database or running dev servers. The backend script is only type-checked and linted, never executed. Do not push. Commit after each task.

## Review Focus

- A redelivered or retried WooCommerce order never creates a second order (Task 6).
- A forged or altered webhook is rejected before anything is parsed or queued; a signed ping does not break the endpoint (Task 5).
- A WooCommerce outage, bad config or failed startup never breaks Medusa events, Amazon or Shopify (Tasks 1, 5, 8).
- An unmatched or duplicate SKU never creates a wrong link or a partial order (Tasks 3, 6).
- Drift correction only changes the WooCommerce side and never loops (Task 7).
- Credentials never go over plain HTTP and are never logged (Tasks 1, 2).

---

### Task 1: Foundation — schema, config loader, account row, queue names

**Files:**
- Modify: `src/db/schema.ts`, `src/queue/queues.ts` (queue-name union only)
- Create: `src/woocommerce/config.ts`, `src/woocommerce/account.ts`
- Test: `src/db/schema.test.ts` (extend or the existing schema test file from the Shopify work), `src/woocommerce/config.test.ts`, `src/woocommerce/account.test.ts`

**Interfaces:**
- Produces:
  - `export type WooCommerceConfig = { siteUrl: string; consumerKey: string; consumerSecret: string; webhookSecret: string }`
  - `export const loadWooCommerceConfig = (env?: NodeJS.ProcessEnv): WooCommerceConfig | null` — reads `WOOCOMMERCE_SITE_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`, `WOOCOMMERCE_WEBHOOK_SECRET`; `null` when any is missing/empty OR the site URL is not `https://` (log one line saying why, never the values); trailing slash trimmed; never throws.
  - `export const resolveWooCommerceAccount = async (pool: Pool, config: WooCommerceConfig, encryptionKey: string): Promise<{ id: string; siteUrl: string }>` — finds or creates the single `integration_account` with `marketplace = 'woocommerce'`, stores `shop_domain` (site URL), `api_key` (consumer key), `access_token_encrypted` (encrypted secret), `status = 'connected'`; idempotent.
  - `SyncQueueName` gains `"woocommerce-inventory-sync" | "woocommerce-price-sync" | "woocommerce-order-sync"`.
  - Schema: `integration_account.api_key TEXT`; `channel_listing.external_parent_id TEXT`.

- [ ] **Step 1: Write failing tests:** config returns the object when all four are set; `null` for each missing/empty variable; `null` for `http://...`; trailing slash trimmed; account row created once, second call same id, plaintext secret not stored (`decrypt` round-trips); schema SQL has both new columns and is safe twice.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement** the schema additions, loader, account resolver and queue names.
- [ ] **Step 4: Run** the new tests, the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): add WooCommerce config, account row and schema columns`.

---

### Task 2: WooCommerce REST client and helpers

**Files:**
- Create: `src/woocommerce/client.ts`, `src/woocommerce/products.ts`, `src/woocommerce/orders.ts`
- Test: matching `*.test.ts` files, using an injected `fetchImpl` (and `sleep`).

**Interfaces:**
- Produces:
  - `export class WooCommerceClient { constructor(config: { siteUrl: string; consumerKey: string; consumerSecret: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }); request<T>(method: "GET" | "PUT" | "POST", path: string, opts?: { query?: Record<string, string | number>; body?: unknown }): Promise<{ data: T; totalPages: number }> }` — base `{siteUrl}/wp-json/wc/v3`, HTTP Basic auth (consumer key/secret), reads `X-WP-TotalPages`; throws `PermanentSyncError` on 4xx except 429 (401/403 included, message never contains the key/secret); 429 waits `Retry-After` (bounded retries, injectable `sleep`) then retries; 5xx and network errors are plain `Error`; refuses a non-`https://` site URL at construction.
  - `products.ts`: `listWooListings(client): Promise<{ id: number; parentId: number | null; sku: string; price: string }[]>` — all products (paginated) plus the variations of variable products (`/products/{id}/variations`, paginated); entries without a SKU are omitted; `setWooStock(client, { id: number; parentId: number | null; quantity: number }): Promise<void>` — PUT `/products/{id}` or `/products/{parentId}/variations/{id}` with `{ manage_stock: true, stock_quantity }`, quantity clamped to a non-negative integer; `setWooPrice(client, { id; parentId; price: string }): Promise<void>` — `{ regular_price }` only.
  - `orders.ts`: `NormalizedWooOrder = { wooOrderId: string; status: string; currencyCode: string; buyerEmail: string; items: { sku: string; quantity: number; unitPrice: number }[]; shippingAddress: { first_name; last_name; address_1; city; country_code; postal_code } }`; `normalizeWooOrder(raw: unknown): NormalizedWooOrder` (throws `PermanentSyncError` if malformed; `unitPrice` = line `total` (after discounts, tax excluded) / quantity rounded to a cent; SKU trimmed, missing SKU becomes `""`; shipping address falls back to billing when empty; tax/shipping/fee lines are NOT items); `fetchWooOrder(client, id: string): Promise<NormalizedWooOrder>`; `fetchWooOrdersModifiedSince(client, sinceIso: string): Promise<{ wooOrderId: string }[]>` (paginated, `modified_after`, `status=any`).

- [ ] **Step 1: Write failing tests** with a stub `fetchImpl`: Basic auth header and URL; non-https refused; pagination across two pages incl. variations; SKU-less entries omitted; 401/403 -> `PermanentSyncError` without leaking the key/secret in the message; 429 then success retries once; 500 -> plain `Error`; stock body is `{manage_stock:true, stock_quantity}` and clamps `-3` to `0` and floors `4.9` to `4`; simple vs variation paths; price body is `{regular_price:"12.50"}` only; normalization happy path, tax excluded, missing SKU, whitespace SKU trimmed, billing fallback, malformed order throws, unit price from line total.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** the new tests, the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): add the WooCommerce REST client and helpers`.

---

### Task 3: Link WooCommerce products and variations to StoreCentral variants by SKU

**Files:**
- Create: `src/sync/woocommerce-link.ts`
- Test: `src/sync/woocommerce-link.test.ts`

**Interfaces:**
- Consumes: `WooCommerceClient`/`listWooListings` (Task 2), the account (Task 1), `MedusaAdminClient.listVariantsBySku()` (already exists from the Shopify work).
- Produces: `linkWooCommerceListings(deps: { pool: Pool; medusaClient: MedusaAdminClient; wooClient: WooCommerceClient; integrationAccountId: string }): Promise<{ linked: number; alreadyLinked: number; unmatched: string[]; duplicates: string[] }>` (same result shape and recording rules as `linkShopifyVariants`; read `sync/shopify-link.ts` and mirror it).
- Rows: `channel_listing` with `external_sku`, `external_variant_id` = the WooCommerce id as a string, `external_parent_id` = parent id as a string or NULL, `medusa_variant_id`, `medusa_product_id`, status `published`; inserts use `ON CONFLICT (integration_account_id, external_sku) DO NOTHING`.

- [ ] **Step 1: Write failing tests:** simple and variation links (parent id stored); idempotent re-run; unmatched and duplicate SKUs (either side) are returned, recorded on `sync_job` (`sync_type 'product'`, `external_id` = SKU, `last_error` set) and write no listing; blank SKUs ignored; trimmed case-sensitive exact match.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests, the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): link WooCommerce listings to StoreCentral variants by SKU`.

---

### Task 4: Push stock and price to WooCommerce

**Files:**
- Create: `src/sync/woocommerce-push-inventory.ts`, `src/sync/woocommerce-push-price.ts`
- Test: matching `*.test.ts` files.

**Interfaces:**
- Consumes: Task 3 rows, `setWooStock`/`setWooPrice` (Task 2); read `sync/shopify-push-inventory.ts`, `sync/shopify-push-price.ts` and their tests and MIRROR their conventions exactly (claim/track `sync_job` with `external_id` = channelListingId, Medusa getters, error classification, `last_synced_*` updates, `applyPriceRule` with the post-rule unrounded price stored in `last_synced_price`).
- Produces: `pushWooInventory(deps: { pool; medusaClient; wooClient; integrationAccountId; channelListingId }): Promise<void>` and `pushWooPrice(deps: { pool; medusaClient; wooClient; integrationAccountId; channelListingId }): Promise<void>`.

- [ ] **Step 1: Write failing tests** mirroring the Shopify push tests: pushed quantity = Medusa available quantity, floored and clamped at 0; `last_synced_quantity` set only on success; 4xx -> `PermanentSyncError` with `last_error`; 5xx retryable; price pushed as a 2-decimal USD string after the price rule; non-USD is a permanent failure with nothing pushed; a listing from another account is a permanent failure; a listing without a WooCommerce id is a permanent failure.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests, the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): push stock and price to WooCommerce`.

---

### Task 5: Webhook — signature check, WooCommerce route, Medusa event fan-out

**Files:**
- Create: `src/woocommerce/webhook.ts`
- Modify: `src/webhook/server.ts`
- Test: `src/woocommerce/webhook.test.ts`, `src/webhook/server.test.ts` (extend; existing cases unchanged)

**Interfaces:**
- Produces:
  - `verifyWooSignature(rawBody: string | Buffer, headerValue: string | undefined, secret: string): boolean` — base64 HMAC-SHA256 of the raw bytes, constant-time compare with a length guard, false for missing/malformed.
  - `createWebhookServer` deps gain optional `woocommerce?: { webhookSecret: string; orderQueue: Queue; inventoryQueue: Queue; priceQueue: Queue }` (existing `shopify` option unchanged). With it present: `POST /webhooks/woocommerce` reads raw bytes, verifies `X-WC-Webhook-Signature` BEFORE parsing or queueing (401 on mismatch); a correctly signed body that is not JSON (WooCommerce's form-encoded creation ping, `webhook_id=...`) returns 200 and enqueues nothing; for `X-WC-Webhook-Topic` `order.created` / `order.updated` / `order.restored` it enqueues `{ wooOrderId: String(id) }` on `orderQueue` with `jobId: woocommerce-order-<id>`, `removeOnComplete: true, removeOnFail: true`; other topics return 200 and queue nothing; a failed order enqueue returns 500; the log line for an ignored topic truncates it to ~64 chars. Each Medusa event is additionally enqueued to the WooCommerce inventory/price queues (`{ inventoryLevelId }` / `{ variantId }`), independent of the Amazon and Shopify enqueues; a WooCommerce enqueue failure is logged and never changes the response or blocks the others. Without `woocommerce` deps the route is 404.

- [ ] **Step 1: Write failing tests:** valid/tampered/wrong-secret/missing-header/wrong-length signature (no throw); bad signature -> 401 and queues untouched (assert), also when the body is malformed; valid `order.created` queues one job with the right data and options; the same delivery twice has equal job ids; signed form-encoded ping -> 200, nothing queued; unknown topic -> 200, nothing queued; Medusa event fans out to Amazon, Shopify and WooCommerce queues; a rejecting WooCommerce queue does not stop the others or change the 200; without deps -> 404; the job id passes BullMQ's own validation (`Job.prototype.validateOptions`, as the Shopify webhook test does) and is not integer-like.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement** both pieces (WooCommerce route collects raw Buffer chunks).
- [ ] **Step 4: Run** the new tests, the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): receive WooCommerce webhooks and fan Medusa events out to WooCommerce`.

---

### Task 6: Import WooCommerce orders

**Files:**
- Create: `src/sync/woocommerce-import-order.ts`, `src/sync/woocommerce-order-sync-processor.ts`
- Test: `src/sync/woocommerce-order-sync-processor.test.ts`, `src/sync/woocommerce-import-order.test.ts`

**Interfaces:**
- Consumes: `NormalizedWooOrder`/`fetchWooOrder` (Task 2), `claimOrderSyncJob`, `OrderImportAdapter` + `importClaimedOrder` (read `sync/import-order.ts`, `sync/shopify-import-order.ts`, `sync/shopify-order-sync-processor.ts` and mirror them), linked `channel_listing` rows (Task 3), sales channel named `"WordPress"`.
- Produces: `woocommerceImportAdapter: OrderImportAdapter<NormalizedWooOrder>` (metadata key `woocommerce_order_id`, label "WooCommerce order"), `importClaimedWooOrder(...)`, `WooOrderSyncJobData = { wooOrderId: string }`, and `processWooOrderSyncJob(data, deps: { pool; medusaClient; integrationAccountId; resolveSalesChannelId: () => Promise<string | null>; fetchOrder: (wooOrderId: string) => Promise<NormalizedWooOrder>; staleProcessingMs?: number })` with the same result type as the Shopify processor. Do NOT modify `import-order.ts` behaviour; if the generic flow's log text hard-codes "Amazon order", pass the adapter label through only if that is a no-behaviour-change edit with all existing tests green, otherwise leave it.
- Status gate: `processing`, `completed` import; `pending`, `on-hold` -> `DeferSyncError` (recheck after 30 minutes, same constant as Shopify's); `cancelled`, `refunded`, `failed`, `trash` -> skipped; any other status -> permanent failure. Non-USD -> permanent. A missing/unmapped SKU -> permanent with `last_error` and NO draft/order.

- [ ] **Step 1: Write failing tests:** processing order creates one order in the "WordPress" channel with WooCommerce unit prices and metadata `woocommerce_order_id`; the same order twice (sequential and concurrent claim) -> one order; cancelled/refunded/failed skipped; pending/on-hold deferred, then a processing one imports; unmapped or blank SKU -> permanent, `last_error`, no draft/order; non-USD permanent; missing WordPress channel retryable; Medusa 4xx permanent; sync_job ends `succeeded` with `medusa_entity_id`; the existing Amazon and Shopify import tests pass unchanged. Show a mutation check in the report: remove the duplicate-order guard and see the idempotency test fail; let an unmapped SKU fall through to a draft and see the no-partial-order test fail; restore.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests, all import tests, the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): import WooCommerce orders into the WordPress sales channel`.

---

### Task 7: Reconciliation for WooCommerce (drift, new links, missed orders)

**Files:**
- Modify: `src/sync/reconcile.ts` (additive; or a new `src/sync/reconcile-woocommerce.ts` if extraction would touch Shopify behaviour)
- Test: `src/sync/reconcile-woocommerce.test.ts` (stubs, same style as `reconcile-shopify.test.ts`)

**Interfaces:**
- Consumes: WooCommerce `channel_listing` rows with `last_synced_quantity` / `last_synced_price`, `fetchWooOrdersModifiedSince` (Task 2), `applyPriceRule`; read `reconcileShopify` and its test first.
- Produces: `reconcileWooCommerce(deps: { pool; medusaClient; integrationAccountId; inventoryQueue: Queue; priceQueue: Queue; orderQueue: Queue; fetchOrdersSince: (sinceIso: string) => Promise<{ wooOrderId: string }[]> }): Promise<{ inventoryRequeued: number; priceRequeued: number; ordersRequeued: number; failedChecks: number }>` with the same rules as `reconcileShopify`: corrective jobs are `{ channelListingId }` on the WooCommerce queues; the quantity uses the same floor/clamp as `pushWooInventory`; the price comparison applies `applyPriceRule` to Medusa's price (post-rule baseline); a NULL baseline counts as drift; never calls push functions, Medusa writes or WooCommerce writes; missed orders are enqueued with the SAME job data/id/options as the webhook (`{ wooOrderId }`, `woocommerce-order-<id>`, `removeOnComplete/removeOnFail`); `last_synced_at` advances to the scan start whenever the order catch-up succeeded (24h lookback when null); one listing's failure is isolated and counted. Also export `RECONCILE_WOOCOMMERCE_JOB = "reconcile-woocommerce"`.

- [ ] **Step 1: Write failing tests:** quantity drift and price drift each requeue one job; no drift requeues nothing; a NULL baseline is enqueued once per run until pushed; a price rule applied on the Medusa side does not loop (two consecutive runs enqueue nothing second time); a missed order is enqueued with the webhook's exact options; a failing listing is isolated and the watermark still advances when the order fetch succeeded; a failed order fetch does not advance it; no Medusa write, push or WooCommerce write is ever called (assert via stubs). Mutation check in the report: drop `applyPriceRule` in the price comparison and see the no-loop test fail.
- [ ] **Step 2: Run and see them fail (RED).**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests, the existing reconcile tests (unchanged), the full suite, and `build`.
- [ ] **Step 5: Commit** `feat(seller-hub): reconcile WooCommerce stock, price and missed orders`.

---

### Task 8: Bootstrap wiring, backend setup script, docs, end-to-end test

**Files:**
- Create: `src/woocommerce/bootstrap.ts`, `src/woocommerce/woocommerce-sync.e2e.test.ts`, `apps/backend/src/scripts/setup-woocommerce-channel.ts`
- Modify: `src/index.ts`, `README.md`, `.env.example`

**Interfaces:**
- Consumes: everything above; read `src/shopify/bootstrap.ts` and mirror it.
- Produces: `startWooCommerce(deps)` and `startWooCommerceIfConfigured(...)` (catches any failure from `startWooCommerce`, logs `[seller-hub] WooCommerce startup failed, continuing without WooCommerce:` plus only the error message, returns null) returning a runtime with `webhook` deps for `createWebhookServer({ woocommerce })` and a `linked` promise. When `loadWooCommerceConfig()` returns null boot is identical to today with ONE log line. The startup resolves the account, builds `WooCommerceClient`, kicks off the SKU link fire-and-forget (log-only on failure), creates the three `woocommerce-*` queues and workers (inventory worker routes `job.name === RECONCILE_WOOCOMMERCE_JOB` to `reconcileWooCommerce`, otherwise a push job through `resolveInventoryChannelListingId` -> `pushWooInventory`; price worker via `resolvePriceChannelListingId` -> `pushWooPrice`; order worker -> `processWooOrderSyncJob` with the sales channel named `"WordPress"` cached, no routing on job name), and adds the repeatable reconcile job on the WooCommerce inventory queue only. `index.ts` passes the WooCommerce deps to the single existing `createWebhookServer` call and changes nothing in the Amazon or Shopify paths.
- `setup-woocommerce-channel.ts` mirrors `setup-shopify-channel.ts`: ensures a sales channel named `WordPress`, links it to the stock location(s) and every product, safe to re-run. Do NOT run it.
- README: a "WooCommerce (WordPress)" section: env variables, creating a REST API key (WooCommerce -> Settings -> Advanced -> REST API, read/write), creating webhooks (Settings -> Advanced -> Webhooks) for `Order created` and `Order updated` pointing to `https://<public-host>/webhooks/woocommerce` with the same secret as `WOOCOMMERCE_WEBHOOK_SECRET`, HTTPS-only credentials, StoreCentral is the master (first sync overwrites WooCommerce stock and regular price and turns on stock management for linked products), the drift check as the fallback while no public URL exists, running the setup script, the unverified-against-a-real-store note, the brief oversell window. `.env.example` gets the four variables (commented, no secrets).

- [ ] **Step 1: Write the failing end-to-end test** (fake WooCommerce REST via injected `fetchImpl`, fake Medusa admin client, fake pool/queues in the style of `shopify-sync.e2e.test.ts`): listings link by SKU (simple and variation); a correctly signed `order.created` webhook yields exactly one order job, processing it creates exactly one Medusa order and a duplicate delivery creates none; a signed form-encoded ping is acknowledged and queues nothing; a Medusa inventory-level event leads to one stock PUT with the available quantity and `manage_stock: true`; a Medusa price event leads to one `regular_price` PUT; a forged webhook is rejected with 401 and nothing changes; with config missing nothing starts; a throwing startup resolves to null and the Amazon-facing webhook server still serves `/webhooks/medusa` and 404s `/webhooks/woocommerce`.
- [ ] **Step 2: Run and see it fail (RED).**
- [ ] **Step 3: Implement** the bootstrap, `index.ts` wiring, script, README and `.env.example`.
- [ ] **Step 4: Run** the e2e test, the full seller-hub suite, `yarn workspace @dtc/seller-hub build`, and from `apps/backend` the type check and `npx medusa lint` for the new script (0 errors; 3 pre-existing warnings are fine). Do NOT execute the setup script.
- [ ] **Step 5: Commit** `feat(seller-hub): wire WooCommerce sync into the service and add the WordPress channel setup script`.
