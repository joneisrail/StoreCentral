# Marketplace Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin screen to connect Shopify and WordPress (WooCommerce) to a sales channel, with credentials stored encrypted by seller-hub and applied live without a restart.

**Architecture:** Seller-hub gets an authenticated internal API (`/internal/connections`) backed by a connector manager that starts, stops and swaps the Shopify and WooCommerce runtimes. Credentials are read from the database first, env variables second. The Medusa backend exposes `/admin/marketplace-connections` routes that forward to seller-hub, and a new admin page renders one card per marketplace. Amazon is shown read-only.

**Tech Stack:** Node 20 + TypeScript ESM (`.js` import suffixes) + vitest + pg + BullMQ in `apps/seller-hub`; Medusa v2 routes (Zod from `@medusajs/framework/zod`), React admin page with `@medusajs/ui`, jest in `apps/backend`.

**Spec:** `docs/superpowers/specs/2026-11-13-marketplace-connections-design.md`

## Global Constraints

- One connection per marketplace (`shopify`, `woocommerce`). `amazon` is read-only: `PUT`/`DELETE` return 400 "not supported yet".
- Credentials are write-only: never returned (not even masked), never logged, never in an error message, never stored in the Medusa database. Encrypt with `crypto/secret-box.ts` (`encrypt`, `decrypt`).
- Internal API requires `Authorization: Bearer <SELLER_HUB_INTERNAL_SECRET>` (constant-time compare), 401 otherwise. When the secret is unset the `/internal/*` routes are not served (404).
- WooCommerce site URL must be `https://`; anything else is rejected before any request. Connection test timeout is 10 seconds.
- Save order: merge input with stored values (blank secret keeps stored) -> test -> only on success persist and apply. A failed test changes nothing.
- A failure in one connector never stops Amazon, the other connector, or the webhook server. Applies are serialized per marketplace.
- Webhook routes resolve the live connector per request; while a connector is stopped they return 503.
- Existing env variables (`SHOPIFY_*`, `WOOCOMMERCE_*`) keep working as a fallback; a saved database connection (one with `webhook_secret_encrypted` set) takes precedence.
- Only GET, POST, DELETE on Medusa routes (never PUT/PATCH). Seller-hub internal API uses `PUT` as in the spec.
- Existing Amazon, Shopify and WooCommerce tests must pass unchanged. No real Shopify, WooCommerce or Amazon calls anywhere; fakes only. Do not push; do not run setup scripts.
- Commit style: `type(scope): message`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Credentials leak into any response, log line or error (tests: Task 1, 4, 6, 8 assert a distinctive secret string never appears in output/logs).
- A failed test on save leaves the running connection and stored credentials untouched (Task 6).
- Two simultaneous saves for one marketplace never duplicate workers or leave a half-stopped connector (Task 4).
- A webhook arriving mid-swap gets 503, not a crash or a 200 that drops the order (Task 5).
- An env-only setup (no database connection) still starts exactly as today (Task 4, 7).
- Disconnect while env variables still exist: the connection comes back on the next restart, so the response must say so (Task 6, 9).

---

### Task 1: Schema columns and credential store

**Files:**
- Modify: `apps/seller-hub/src/db/schema.ts` (append additive statements)
- Create: `apps/seller-hub/src/connectors/credentials.ts`
- Test: `apps/seller-hub/src/connectors/credentials.test.ts`, extend `apps/seller-hub/src/db/schema.test.ts` for the new columns

**Interfaces:**
- Consumes: `encrypt`/`decrypt` from `../crypto/secret-box.js`; `ShopifyConfig` (`../shopify/config.js`); `WooCommerceConfig` (`../woocommerce/config.js`); `loadShopifyConfig`, `loadWooCommerceConfig` (env loaders).
- Produces (all in `connectors/credentials.ts`):
  - `type Marketplace = "shopify" | "woocommerce"`
  - `type ConfigSource = "database" | "environment" | "none"`
  - `type ShopifyInput = { shopDomain?: string; accessToken?: string; webhookSecret?: string; locationId?: string }` and `type WooInput = { siteUrl?: string; consumerKey?: string; consumerSecret?: string; webhookSecret?: string }` (blank/undefined/whitespace-only = keep stored)
  - `class ConnectionInputError extends Error { fields: string[] }` thrown by the merge functions when a required field is missing after merging
  - `resolveShopifyConfig(pool, encryptionKey, env?): Promise<{ config: ShopifyConfig; source: ConfigSource } | null>` and `resolveWooConfig(...)` likewise: database row first (only when `webhook_secret_encrypted` is non-null and every field present), else the env loader, else null
  - `mergeShopifyInput(stored: ShopifyConfig | null, input: ShopifyInput): ShopifyConfig` and `mergeWooInput(stored: WooCommerceConfig | null, input: WooInput): WooCommerceConfig` (Woo: trims trailing slashes; non-https throws `ConnectionInputError` with `fields: ["siteUrl"]`)
  - `saveConnection(pool, encryptionKey, marketplace, config, salesChannelId?: string | null): Promise<void>` (upserts the single row for the marketplace, writes `webhook_secret_encrypted`, `medusa_sales_channel_id` only when the argument is not `undefined`)
  - `clearConnection(pool, marketplace): Promise<void>` (NULLs domain, token, api key, location, webhook secret, sales channel; status `disconnected`; last_error NULL; keeps the row, listings and history)
  - `setConnectionStatus(pool, marketplace, status: "connected" | "disconnected" | "error", lastError: string | null): Promise<void>`
  - `listConnectionRows(pool): Promise<ConnectionRow[]>` where `ConnectionRow = { marketplace: string; status: string; lastError: string | null; lastSyncedAt: Date | null; salesChannelId: string | null; linkedListings: number; hasStoredCredentials: boolean; shopDomain: string | null; shopifyLocationId: string | null; apiKeyPresent: boolean }` (no secret values; `hasStoredCredentials` = `webhook_secret_encrypted IS NOT NULL`)
- Schema adds: `integration_account.medusa_sales_channel_id TEXT`, `webhook_secret_encrypted TEXT`, `last_error TEXT`.

- [ ] **Step 1: Write failing tests.** In `schema.test.ts` assert the three new `ADD COLUMN IF NOT EXISTS` statements exist. In `credentials.test.ts` (fake `pg` pool in the style of `shopify/account` tests) cover: `resolveShopifyConfig` prefers a database row with a webhook secret and returns `source: "database"`; falls back to env with `source: "environment"`; returns null when neither exists; a row that has a token but no `webhook_secret_encrypted` is NOT treated as a database connection (env-start wrote it); `mergeShopifyInput` keeps stored values for blank fields and throws `ConnectionInputError` listing every missing field when nothing is stored; `mergeWooInput` rejects `http://` and strips trailing slashes; `saveConnection` stores ciphertext only (the plaintext secret string never appears in any query parameter); `clearConnection` NULLs the credential columns and sets `disconnected`; `listConnectionRows` result JSON never contains the secret strings.
- [ ] **Step 2: Run** `cd apps/seller-hub && npx vitest run src/connectors/credentials.test.ts src/db/schema.test.ts`; expect FAIL (module/columns missing).
- [ ] **Step 3: Implement** the schema statements and `credentials.ts` per the Interfaces block. Reuse `loadShopifyConfig`/`loadWooCommerceConfig` for the env fallback. Decrypt only inside `resolve*` and never log values.
- [ ] **Step 4: Run** the same command; expect PASS. Then `npx vitest run src/db` to confirm migrations tests still pass.
- [ ] **Step 5: Commit** `feat(seller-hub): store marketplace connection credentials in the database`.

---

### Task 2: Connection testers

**Files:**
- Create: `apps/seller-hub/src/connectors/test-connection.ts`
- Test: `apps/seller-hub/src/connectors/test-connection.test.ts`

**Interfaces:**
- Consumes: `ShopifyClient` (`shopify/client.ts`, its `graphql` method), `WooCommerceClient` (`woocommerce/client.ts`, its `request` method), `ShopifyConfig`, `WooCommerceConfig`. Read both client files for the exact call shapes.
- Produces:
  - `type TestResult = { ok: true; detail: string } | { ok: false; message: string }`
  - `testShopifyConnection(config: ShopifyConfig, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<TestResult>` runs `{ shop { name } }` and also checks `config.locationId` exists via a location query (message "location not found" if not)
  - `testWooCommerceConnection(config: WooCommerceConfig, opts?: same): Promise<TestResult>` reads `GET /products?per_page=1`
  - Both default `timeoutMs` to 10000, never throw, and return short messages that never include the token, key, secret or full URL query strings.

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl`: Shopify ok returns `{ ok: true }` with the shop name in `detail`; 401 returns `ok: false` with a "credentials rejected" style message; unknown location returns `ok: false`; Woo ok; Woo 401; network error; a fetch that never resolves returns `ok: false` "timed out" after the injected small `timeoutMs`; in every failure the message does not contain the access token / consumer secret used in the test (assert with distinctive strings); a non-https Woo URL returns `ok: false` and the fake fetch was never called.
- [ ] **Step 2: Run** `npx vitest run src/connectors/test-connection.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** both functions with a `Promise.race` timeout wrapper; map `PermanentSyncError`/HTTP statuses to short messages (401/403 -> credentials rejected, 404 -> not found, other -> "request failed (status)").
- [ ] **Step 4: Run** the test; expect PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): add Shopify and WooCommerce connection testers`.

---

### Task 3: Stoppable runtimes, sales channel id, relink

**Files:**
- Modify: `apps/seller-hub/src/shopify/bootstrap.ts`, `apps/seller-hub/src/woocommerce/bootstrap.ts`
- Test: extend their existing bootstrap tests (`shopify/bootstrap.test.ts`, `woocommerce/bootstrap.test.ts` if present, else add)

**Interfaces:**
- Consumes: existing `createSyncQueue`/`createSyncWorker` (returns a BullMQ `Worker`; queues are BullMQ `Queue`).
- Produces: `ShopifyRuntime` and `WooCommerceRuntime` gain
  - `stop(): Promise<void>` closes all three workers and three queues, and removes the repeatable reconcile job (`RECONCILE_SHOPIFY_JOB` / `RECONCILE_WOOCOMMERCE_JOB`, `{ every: reconcileIntervalMs }`) so a disconnect stops the schedule; safe to call twice
  - `relink(): Promise<LinkResult>` runs the SKU link again and returns its result
  - `StartShopifyDeps` and `StartWooCommerceDeps` gain optional `salesChannelId?: string | null`; when set, the order worker uses it directly instead of `findSalesChannelIdByName`
- Existing behaviour and exports are otherwise unchanged. The injected `createWorker` fake in tests may return an object with `close()`; keep the default tolerant of fakes that return `undefined` only if existing tests require it, otherwise update the fakes.

- [ ] **Step 1: Write failing tests** for each connector: `stop()` calls `close()` on every worker and queue and removes the repeatable job exactly once, a second `stop()` is a no-op; `relink()` re-runs the link and returns counts; with `salesChannelId: "sc_1"` the order processor's `resolveSalesChannelId` returns `sc_1` and `findSalesChannelIdByName` is never called; without it the old name lookup (`"Shopify"` / `"WordPress"`) still happens.
- [ ] **Step 2: Run** the two test files; expect FAIL.
- [ ] **Step 3: Implement** by retaining the created workers/queues in arrays, adding `stop`, `relink` and `salesChannelId`. Do not change processors.
- [ ] **Step 4: Run** `npx vitest run src/shopify src/woocommerce src/sync` ; expect PASS (existing tests unchanged).
- [ ] **Step 5: Commit** `feat(seller-hub): make Shopify and WooCommerce runtimes stoppable`.

---

### Task 4: Connector manager

**Files:**
- Create: `apps/seller-hub/src/connectors/manager.ts`
- Test: `apps/seller-hub/src/connectors/manager.test.ts`

**Interfaces:**
- Consumes: Task 1 (`resolveShopifyConfig`, `resolveWooConfig`, `setConnectionStatus`, `clearConnection`), Task 3 runtimes, `startShopify`/`startWooCommerce` from the bootstraps, `listConnectionRows`.
- Produces in `connectors/manager.ts`:
  - `createConnectorManager(deps: { pool; medusaClient; encryptionKey; redisConnection; reconcileIntervalMs; env?: NodeJS.ProcessEnv; startShopify?: typeof startShopify; startWooCommerce?: typeof startWooCommerce }): ConnectorManager`
  - `ConnectorManager = { getShopify(): ShopifyRuntime | null; getWooCommerce(): WooCommerceRuntime | null; apply(marketplace: Marketplace): Promise<{ started: boolean; error?: string }>; stop(marketplace: Marketplace): Promise<void>; applyAll(): Promise<void>; stopAll(): Promise<void> }`
- `apply` behaviour: serialized per marketplace (a second call waits for the first, then re-reads config); resolves config via Task 1 (database, then env, then none); stops any running runtime first; reads `medusa_sales_channel_id` for the account and passes it as `salesChannelId`; on a start error logs only `err.message`, sets status `error` with a message that contains no config values, leaves the manager with no runtime for that marketplace, never throws; with no config sets status `disconnected` and starts nothing; success sets status `connected`, clears `last_error`.

- [ ] **Step 1: Write failing tests** with fake start functions returning runtimes whose `stop` is a spy: env-only config starts exactly one runtime (as today); a database config takes precedence over env; `apply` twice concurrently results in exactly one running runtime, the first stopped before the second starts, and start order is strictly sequential (record call order); a start function that throws leaves `getShopify()` null, status `error`, and `apply("woocommerce")` still works; the thrown message with an embedded secret never appears in the stored `last_error` or in captured console output; `stop` stops the runtime and `getX()` returns null; `applyAll` applies both marketplaces independently even if one fails.
- [ ] **Step 2: Run** `npx vitest run src/connectors/manager.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** with a per-marketplace promise-chain lock.
- [ ] **Step 4: Run** the test; expect PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): add a connector manager that applies connections live`.

---

### Task 5: Webhook server resolves connectors per request

**Files:**
- Modify: `apps/seller-hub/src/webhook/server.ts`
- Test: extend `apps/seller-hub/src/webhook/server.test.ts`

**Interfaces:**
- Produces: in `CreateWebhookServerDeps`, `shopify` and `woocommerce` accept either the existing deps object or a function `() => deps | null`; new optional `internalHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>`. Requests whose URL starts with `/internal/` go to `internalHandler` when present, otherwise 404.
- Behaviour: a getter is called on every request (including the Medusa fan-out). If the getter is configured but returns null: `POST /webhooks/shopify` / `/webhooks/woocommerce` respond 503 and the Medusa fan-out simply skips that marketplace. A plain object behaves exactly as today.

- [ ] **Step 1: Write failing tests**: getter returning deps behaves like the object form (valid signed order enqueued); getter returning null gives 503 on the order route and an unchanged 200 on `/webhooks/medusa`; swapping the getter's return value between two requests changes which queue receives the order; `/internal/anything` goes to the handler when supplied and is 404 when not; all existing tests still pass untouched.
- [ ] **Step 2: Run** `npx vitest run src/webhook/server.test.ts`; expect FAIL on the new tests only.
- [ ] **Step 3: Implement** a small `resolveDeps(x)` helper and use it at the top of each request branch; keep raw-body handling unchanged.
- [ ] **Step 4: Run** the file; expect all PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): resolve marketplace webhook deps per request`.

---

### Task 6: Internal connections API

**Files:**
- Create: `apps/seller-hub/src/internal/auth.ts`, `apps/seller-hub/src/internal/connections.ts`
- Test: `apps/seller-hub/src/internal/auth.test.ts`, `apps/seller-hub/src/internal/connections.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (credentials, testers, manager).
- Produces:
  - `isAuthorized(header: string | undefined, secret: string): boolean` (constant-time via `timingSafeEqual` on equal-length digests; false for missing/empty/`Bearer` mismatch)
  - `createInternalHandler(deps: { pool; manager: ConnectorManager; encryptionKey: string; secret: string; publicUrl?: string; env?: NodeJS.ProcessEnv; testShopify?: typeof testShopifyConnection; testWoo?: typeof testWooCommerceConnection }): (req, res) => Promise<void>`
- Routes (JSON; body capped at 64 KB -> 413; unknown path 404; wrong method 405):
  - `GET /internal/connections` -> `{ connections: [{ marketplace, status, last_error, last_synced_at, linked_listings, sales_channel_id, credentials_source, read_only, fields, webhook_url }] }` for `shopify`, `woocommerce`, `amazon`. `fields` holds only non-secret values (`shop_domain`, `location_id` / `site_url`, `consumer_key_set`: boolean). `webhook_url` is `publicUrl + "/webhooks/<marketplace>"` or just the path. `amazon.read_only = true`. `credentials_source` comes from `resolve*Config`.
  - `PUT /internal/connections/:marketplace` body `{ shop_domain?, access_token?, webhook_secret?, location_id?, site_url?, consumer_key?, consumer_secret?, sales_channel_id? }`: merge (Task 1) -> 400 `{ error: "invalid_input", fields }` on `ConnectionInputError` -> test -> on failure 422 `{ error: "test_failed", message }` and NOTHING stored or restarted -> on success `saveConnection` then `manager.apply` -> 200 `{ ok: true, connection }` (or 200 with `ok: false, error` if apply reported a start error, status `error` persisted).
  - `POST /internal/connections/:marketplace/test` -> tests stored credentials, updates status/last_error, returns the `TestResult`.
  - `POST /internal/connections/:marketplace/link` -> `manager.get...().relink()` -> `{ linked, already_linked, unmatched: number, duplicates: number }`; 409 if the connector is not running.
  - `DELETE /internal/connections/:marketplace` -> `manager.stop`, `clearConnection`, then `{ ok: true, env_fallback: boolean }` where `env_fallback` is true when the env loader still yields a config (the connection would return on restart).
  - `amazon` on PUT/POST/DELETE -> 400 `{ error: "not_supported" }`. Unknown marketplace -> 404.
- Every route first checks `isAuthorized`; failure -> 401 with no body detail.

- [ ] **Step 1: Write failing tests** (auth): missing header, `Bearer wrong`, wrong scheme, empty secret, correct token, tokens of different length. (connections, fake pool, fake manager, fake testers, injected env): 401 on every route without the token; GET never contains the distinctive secret strings used in fixtures and marks amazon read-only; PUT with failing tester returns 422, performs no `saveConnection` write and never calls `manager.apply`; PUT success stores, applies, and the response/console output contain no secret; blank `access_token` on an update keeps the stored one (tester receives the stored token); missing fields -> 400 listing them; `http://` Woo URL -> 400 before the tester is called; link returns counts and 409 when not running; DELETE returns `env_fallback: true` when env vars exist and false otherwise; body over 64 KB -> 413.
- [ ] **Step 2: Run** `npx vitest run src/internal`; expect FAIL.
- [ ] **Step 3: Implement** both files; no new dependencies (plain `node:http` types, `JSON.parse` with try/catch -> 400).
- [ ] **Step 4: Run** `npx vitest run src/internal`; expect PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): add the authenticated internal connections API`.

---

### Task 7: Wire into the service and document

**Files:**
- Modify: `apps/seller-hub/src/index.ts`, `apps/seller-hub/.env.example`, `apps/seller-hub/README.md`
- Test: `apps/seller-hub/src/connectors/connections.e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 6.
- Produces: `index.ts` creates the manager (replacing the direct `startShopifyIfConfigured`/`startWooCommerceIfConfigured` calls), awaits `manager.applyAll()` (never throws), passes `shopify: () => manager.getShopify()?.webhook ?? null` and `woocommerce: () => ...` plus `internalHandler` (only when `SELLER_HUB_INTERNAL_SECRET` is set) to `createWebhookServer`. New env: `SELLER_HUB_INTERNAL_SECRET` (optional), `SELLER_HUB_PUBLIC_URL` (optional). Env-only setups start exactly as before.

- [ ] **Step 1: Write the failing e2e test** with fake Shopify and WooCommerce HTTP servers (or `fetchImpl` fakes), fake Redis queues via the existing injection points, a real `createWebhookServer` on an ephemeral port and the real internal handler: PUT a Shopify connection with good credentials, then a signed `orders/paid` webhook is enqueued; PUT with a bad token returns 422 and the earlier connection still accepts webhooks; PUT new credentials swaps the live webhook secret (old signature now 401, new 200) without restarting the server; DELETE makes `/webhooks/shopify` return 503; with no `SELLER_HUB_INTERNAL_SECRET` the `/internal/connections` route is 404; a Woo start failure leaves Shopify serving.
- [ ] **Step 2: Run** `npx vitest run src/connectors/connections.e2e.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the `index.ts` wiring; update `.env.example` and add a README section ("Managing connections from the admin", the internal secret, public URL, and that env variables remain a fallback and disconnect needs the env variables removed to stay disconnected).
- [ ] **Step 4: Run** the e2e test, then the full seller-hub suite (`npx vitest run`) and `npm run build`; expect all PASS and a clean build (known flaky: `admin-client.test.ts` getVariantPricing, `queues.test.ts` retry; re-run once if only those fail).
- [ ] **Step 5: Commit** `feat(seller-hub): apply marketplace connections live from the connector manager`.

---

### Task 8: Backend routes

**Files:**
- Create: `apps/backend/src/api/admin/marketplace-connections/seller-hub-client.ts`, `.../middlewares.ts`, `.../route.ts` (GET list), `.../[marketplace]/route.ts` (POST save, DELETE disconnect), `.../[marketplace]/test/route.ts` (POST), `.../[marketplace]/link/route.ts` (POST)
- Modify: `apps/backend/src/api/middlewares.ts` (spread `marketplaceConnectionMiddlewares`), `apps/backend/.env.example`
- Test: `apps/backend/src/api/admin/marketplace-connections/__tests__/seller-hub-client.unit.spec.ts`, `__tests__/routes.unit.spec.ts`

**Interfaces:**
- Produces: `callSellerHub(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown, opts?: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv }): Promise<{ status: number; body: any }>` reading `SELLER_HUB_INTERNAL_URL` and `SELLER_HUB_INTERNAL_SECRET`, 15 s timeout. Error mapping via `MedusaError`/status: either variable unset -> 503 "Marketplace connections are not configured"; network failure or timeout -> 502 "Cannot reach seller-hub"; seller-hub 401 -> 502 "seller-hub rejected the shared secret"; seller-hub 4xx/422 -> same status with seller-hub's `message`/`error`. Never logs bodies or the secret.
- Routes (admin-authenticated by Medusa; Zod from `@medusajs/framework/zod`, `z.strictObject`, string fields trimmed, `sales_channel_id` optional): `GET /admin/marketplace-connections`; `POST /admin/marketplace-connections/:marketplace` (forwards as `PUT`, marketplace limited to `shopify|woocommerce`, amazon -> 400); `DELETE /admin/marketplace-connections/:marketplace`; `POST .../:marketplace/test`; `POST .../:marketplace/link`. No workflow is needed: nothing in the Medusa database is written (state lives in seller-hub); note this in a one-line comment in `route.ts`.

- [ ] **Step 1: Write failing tests**: client: sends the Bearer secret, never logs/ throws the secret, maps each error case above; routes (call handlers with fake `req`/`res` and a mocked `callSellerHub`): validation rejects unknown keys and a non-string secret; blank strings are forwarded as omitted so stored secrets are kept; amazon is 400; seller-hub 422 `test_failed` reaches the caller with its message; the response never contains a submitted secret value.
- [ ] **Step 2: Run** `cd apps/backend && yarn test:unit -- marketplace-connections`; expect FAIL.
- [ ] **Step 3: Implement** the files and register the middlewares; add `SELLER_HUB_INTERNAL_URL` and `SELLER_HUB_INTERNAL_SECRET` to `.env.example` next to `SELLER_HUB_WEBHOOK_URL`.
- [ ] **Step 4: Run** the tests; expect PASS. Then `npx tsc --noEmit` and `npx medusa lint` in `apps/backend`; expect clean for the new files.
- [ ] **Step 5: Commit** `feat(backend): add admin routes that forward marketplace connections to seller-hub`.

---

### Task 9: Admin page

**Files:**
- Create: `apps/backend/src/admin/routes/marketplace-connections/page.tsx`, `.../types.ts`
- Test: `apps/backend/src/admin/routes/marketplace-connections/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: Task 8 routes via `sdk.client.fetch` (`../../../lib/sdk`); sales channels via `sdk.admin.salesChannel.list()`.
- Produces: default export `MarketplaceConnectionsPage`, and `export const config = defineRouteConfig({ label: "Marketplace connections" })`. One card per marketplace in the order Shopify, WordPress, Amazon.
  - Shopify fields: store domain, access token, webhook secret, location id. WordPress fields: site URL, consumer key, consumer secret, webhook secret. Secret inputs are `type="password"`, always empty on load, with a "Stored" hint when credentials exist; submitting a blank secret keeps the stored one.
  - Each card: sales channel select, status badge, last sync, linked listings, latest error, webhook URL (after a successful save and whenever returned), buttons Save and connect / Test / Link products by SKU / Disconnect (with a confirm step; after a disconnect with `env_fallback: true` show a warning that env variables will reconnect it on restart). Buttons disable while their action runs. Cards load, fail and retry independently. Amazon card is read-only (status only).
  - Query keys under `["admin","marketplace-connections"]`; mutations invalidate them.

- [ ] **Step 1: Write failing component tests** in the style of `accounting/overview/__tests__/page.unit.spec.tsx` (jest jsdom, `QueryClientProvider`, mocked `sdk`): three cards render; secret inputs are empty password fields and the page DOM never contains a stored secret value; save sends only non-blank fields plus `sales_channel_id` to `POST /admin/marketplace-connections/shopify`; a 422 test failure shows its message on that card and not on the other; Test and Link call their routes and show results; Disconnect asks for confirmation before calling `DELETE`, then shows the env fallback warning when returned; webhook URL shown after save; Amazon card has no inputs or buttons; a failing list request shows an error with Retry; unreachable seller-hub (502) shows a banner while the page stays usable.
- [ ] **Step 2: Run** `cd apps/backend && yarn test:unit -- marketplace-connections/__tests__/page`; expect FAIL.
- [ ] **Step 3: Implement** the page with `@medusajs/ui` components (`Container`, `Heading`, `Input`, `Select`, `Button`, `Badge`, `Text`), no new dependencies.
- [ ] **Step 4: Run** the tests, the whole backend `yarn test:unit`, `npx tsc --noEmit`, `npx medusa lint`; expect PASS and clean.
- [ ] **Step 5: Commit** `feat(backend): add the Marketplace connections admin page`.
