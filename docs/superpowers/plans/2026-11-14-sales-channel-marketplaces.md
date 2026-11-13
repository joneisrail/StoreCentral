# Marketplaces inside Sales Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add marketplaces (many Shopify, WordPress and Amazon connections) from the Sales channels area of the admin, replacing the standalone "Marketplace connections" page.

**Architecture:** seller-hub's connector manager becomes keyed by `integration_account.id` (many per marketplace) with id-based internal API and per-id webhook URLs. The backend gains a workflow that creates the sales channel and forwards the connection to seller-hub. The dashboard fork's sales channel create form gets a marketplace picker, and the detail page gets a "Marketplace connection" section.

**Tech Stack:** Node 20 TypeScript ESM (`.js` import suffixes), vitest, pg, BullMQ (seller-hub); Medusa v2, Zod from `@medusajs/framework/zod`, jest (backend); React, react-hook-form, react-i18next, vitest (`packages/admin/dashboard`).

**Spec:** `docs/superpowers/specs/2026-11-14-sales-channel-marketplaces-design.md` (builds on `2026-11-13-marketplace-connections-design.md`, already merged).

## Global Constraints

- Credentials are write-only: never returned, logged (log only the marketplace and the error constructor name) or stored in the Medusa database.
- Medusa routes use only GET/POST/DELETE. Zod comes from `@medusajs/framework/zod` (v4, `z.strictObject`).
- seller-hub keeps `.js` import suffixes; BullMQ queue names cannot contain `:` and job ids cannot be integers.
- No real Shopify, WooCommerce or Amazon calls; never write to the live site; never run setup scripts against the dev DB; do not restart the dev server.
- Existing tests keep passing unchanged. Known flaky: `apps/seller-hub/src/medusa/admin-client.test.ts` (getVariantPricing, needs a live backend) and `src/queue/queues.test.ts` retry count.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push or merge.
- Admin strings go in the dashboard's `en.json` via `t()`; follow the neighbouring components' patterns.
- Amazon is saved-only: no Amazon runtime and no outbound Amazon call from the new code.

## Review Focus

- A failed connection test never blocks saving the channel, never starts a connector, and never overwrites a currently `connected` connection's credentials on edit.
- Two connections of one type never share queues, listings, jobs or webhooks; one failing never stops another, the legacy connector, or Medusa fan-out.
- A per-id webhook with a wrong/unknown id or a signature from a different connection's secret is rejected (404/401), never processed.
- Existing single-account and env-configured setups, and their old `/webhooks/shopify` and `/webhooks/woocommerce` URLs, keep working.
- Secrets never appear in any response, log line or thrown message (create, edit, test, list, delete paths).
- Seller-hub down during create keeps the sales channel and reports "connection not stored"; deleting a sales channel with a connection is blocked.

---

### Task 1: seller-hub data layer (many connections, id-based credentials)

**Files:**
- Modify: `apps/seller-hub/src/db/schema.ts`, `apps/seller-hub/src/connectors/credentials.ts`, `apps/seller-hub/src/shopify/account.ts`, `apps/seller-hub/src/woocommerce/account.ts`
- Test: `apps/seller-hub/src/connectors/credentials.test.ts` (extend the existing), `apps/seller-hub/src/db/schema.test.ts` if present

**Interfaces:**
- Produces (schema, additive/idempotent): `integration_account.managed BOOLEAN NOT NULL DEFAULT false`, `display_name TEXT`, `amazon_seller_id TEXT`, `amazon_marketplace_id TEXT`; a unique partial index on `medusa_sales_channel_id WHERE medusa_sales_channel_id IS NOT NULL`; backfill `managed = true` for rows with `webhook_secret_encrypted IS NOT NULL`.
- Produces (credentials.ts), `Marketplace = "shopify" | "woocommerce" | "amazon"`:
  - `AmazonInput = { sellerId?: string; marketplaceId?: string; refreshToken?: string }`
  - `ConnectionRow` gains `id`, `displayName`, `managed`, `amazonSellerId`, `amazonMarketplaceId`; `listConnectionRows(pool)` returns every row (managed first by `created_at`, then legacy).
  - `createConnectionRow(pool, { marketplace, salesChannelId, displayName }): Promise<string>` inserts a managed row with status `disconnected` and returns its id; rejects a sales channel that already has a connection (`ConnectionInputError(["sales_channel_id"])`).
  - `loadStoredConfig(pool, key, id): Promise<ShopifyConfig | WooCommerceConfig | AmazonConfig | null>` (null when the row has no stored credentials; throws on undecryptable ciphertext).
  - `saveConnectionById(pool, key, id, config, status, lastError)`, `clearConnectionById(pool, id)` (wipes credentials, keeps the row, listings and `medusa_sales_channel_id`, status `disconnected`), `setStatusById(pool, id, status, lastError)`.
  - `mergeShopifyInput`, `mergeWooInput` unchanged; add `mergeAmazonInput(stored, input)` (`marketplaceId` defaults to `ATVPDKIKX0DER`; `sellerId`, `refreshToken` required).
  - `resolveLegacyConfig(pool, key, marketplace, env)`: the env/`managed = false` path used only when no managed row exists for that marketplace; replaces `resolveShopifyConfig`/`resolveWooConfig`.
- `resolveShopifyAccount` / WooCommerce account resolver now match only `managed = false` rows.

- [ ] **Step 1: Failing tests.** In `credentials.test.ts` add: `createConnectionRow rejects a sales channel that already has a connection`; `loadStoredConfig returns null for a row without credentials`; `loadStoredConfig throws on undecryptable ciphertext`; `two shopify rows coexist and save independently`; `clearConnectionById keeps the sales channel link and listings`; `resolveLegacyConfig is used only when no managed row exists for the marketplace`; `mergeAmazonInput defaults the marketplace id and requires seller id and refresh token`; `backfill marks rows with a webhook secret as managed` (run the schema SQL twice, assert idempotent).
- [ ] **Step 2: Run** `cd apps/seller-hub && npx vitest run src/connectors/credentials.test.ts` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** the schema statements and the credentials functions above, keeping secret columns out of every `SELECT` list view (`has_stored_credentials` = `webhook_secret_encrypted IS NOT NULL` for shopify/woocommerce, `lwa_refresh_token_encrypted IS NOT NULL` for amazon). Update the two account resolvers to add `AND managed = false`. Remove the old marketplace-keyed functions only after Task 4 stops using them; until then keep thin wrappers so the build stays green (delete them in Task 4).
- [ ] **Step 4: Run** the credentials tests and `npx tsc --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): many managed connections per marketplace in the data layer`.

---

### Task 2: connector manager keyed by connection id; per-account bootstrap

**Files:**
- Modify: `apps/seller-hub/src/connectors/manager.ts`, `src/shopify/bootstrap.ts`, `src/woocommerce/bootstrap.ts`, `src/connectors/manager.test.ts`, `src/shopify/bootstrap.test.ts`, `src/woocommerce/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 1's `listConnectionRows`, `loadStoredConfig`, `resolveLegacyConfig`, `setStatusById`.
- Produces `ConnectorManager`:
  ```ts
  type LiveConnector =
    | { id: string; marketplace: "shopify"; runtime: ShopifyRuntime }
    | { id: string; marketplace: "woocommerce"; runtime: WooCommerceRuntime }
  type ConnectorManager = {
    get(id: string): LiveConnector | null
    list(marketplace?: "shopify" | "woocommerce"): LiveConnector[] // creation order; legacy last
    apply(id: string): Promise<{ started: boolean; error?: string }>
    stop(id: string): Promise<void>
    applyAll(): Promise<void> // every managed shopify/woocommerce row with credentials, plus the legacy env connector per marketplace that has no managed row
    stopAll(): Promise<void>
  }
  ```
  The legacy env connector is addressed by its (managed = false) row id. Amazon rows are ignored by the manager.
- `startShopify` / `startWooCommerce` gain `accountId?: string` and `displayId?: string`: when `accountId` is set the runtime uses that row (no `resolve*Account`) and names its queues `shopify-order-sync-<id>` / `-inventory-sync-<id>` / `-price-sync-<id>` (same for woocommerce); without it behaviour and queue names are unchanged. `ShopifyRuntime`/`WooCommerceRuntime` keep their shape; `salesChannelId` still comes from the row.
- Per-id lock (promise chain per id); start/stop failures isolated to that id; status written with `setStatusById`; logs carry only the marketplace and error constructor name.
- At `applyAll`, for each marketplace whose legacy queues are not used by a legacy runtime, remove stale legacy repeatables (`removeRepeatable("reconcile-shopify" / woo name, { every })` on the legacy inventory queue) so migrated rows do not leave an orphaned hourly job.

- [ ] **Step 1: Failing tests** in `manager.test.ts` (fake `startShopify`/`startWooCommerce`): `two shopify connections start independently with distinct runtimes`; `stopping one leaves the other running`; `one failing start leaves the other running and sets only its own status error`; `concurrent applies for one id run one at a time, different ids run in parallel`; `legacy env connector is skipped when a managed row exists for that marketplace`; `legacy env connector starts when no managed row exists`; `amazon rows are ignored`; `queue names include the account id` (bootstrap tests with fake `createQueue`); `legacy start without accountId keeps the old queue names`.
- [ ] **Step 2: Run** `npx vitest run src/connectors src/shopify src/woocommerce` — new tests FAIL.
- [ ] **Step 3: Implement** the manager rewrite and the bootstrap options; keep `stop()` idempotent and the `linked`-await behaviour.
- [ ] **Step 4: Run** those tests plus `npx tsc --noEmit` — PASS (the internal API and `index.ts` still use the old manager shape; adapt them minimally with a temporary adapter or leave failing type errors for Tasks 3–5 only if the suite compiles per-file — prefer the adapter, removed in Task 4).
- [ ] **Step 5: Commit** `feat(seller-hub): connector manager keyed by connection id`.

---

### Task 3: webhook registry, per-id routes and Medusa fan-out

**Files:**
- Modify: `apps/seller-hub/src/webhook/server.ts`, `src/webhook/server.test.ts` (and the shopify/woocommerce webhook handler tests if they build the server)

**Interfaces:**
- Consumes: Task 2 `ConnectorManager` (`get`, `list`).
- Produces in `server.ts`:
  ```ts
  type WebhookRegistry = {
    get(marketplace: "shopify" | "woocommerce", accountId?: string): ShopifyWebhookDeps | WooCommerceWebhookDeps | null
    all(marketplace: "shopify" | "woocommerce"): Array<ShopifyWebhookDeps | WooCommerceWebhookDeps>
  }
  ```
  `CreateWebhookServerDeps.connectors?: WebhookRegistry` (existing `shopify`/`woocommerce` options keep working unchanged).
- Routes: `POST /webhooks/<shopify|woocommerce>/<accountId>` resolves `registry.get(marketplace, accountId)`; unknown id → 404; stopped → 503; the old un-suffixed URL resolves `registry.get(marketplace)` = the legacy runtime, else the oldest managed runtime of that type. Medusa `/webhooks/medusa` fans out to every `registry.all(marketplace)` entry; each failure logged and isolated.

- [ ] **Step 1: Failing tests:** `per-id shopify webhook routes to that connection's queues`; `unknown id returns 404`; `stopped connection returns 503`; `a signature made with another connection's secret is rejected 401`; `old /webhooks/shopify still routes to the legacy runtime`; `old url falls back to the oldest managed runtime`; `medusa inventory event enqueues on every shopify connection`; `one connection's queue failure does not stop the others or change the 200`; `a throwing registry is treated as not live`.
- [ ] **Step 2: Run** `npx vitest run src/webhook` — FAIL.
- [ ] **Step 3: Implement.** Parse the path segments once; reuse `handleShopifyRequest`/`handleWooCommerceRequest` unchanged.
- [ ] **Step 4: Run** webhook tests + `npx tsc --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): per-connection webhook routes and Medusa fan-out`.

---

### Task 4: internal API, id-based, save-without-passing-test, Amazon storage

**Files:**
- Modify: `apps/seller-hub/src/internal/connections.ts`, `src/connectors/test-connection.ts` (only if a signature changes), `src/internal/connections.test.ts`
- Remove: the old marketplace-keyed wrappers kept in Task 1/2.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces routes (bearer auth, 64 KB cap unchanged): `GET /internal/connections`; `POST /internal/connections`; `PUT /internal/connections/:id`; `DELETE /:id`; `POST /:id/test`; `POST /:id/link`.
- Connection view (snake_case): `{ id, marketplace, display_name, status, last_error, last_synced_at, linked_listings, sales_channel_id, managed, read_only, credentials_source, sync_live, fields, webhook_url }`. `webhook_url = <publicUrl>/webhooks/<marketplace>/<id>`; legacy rows `read_only: true`, `credentials_source: "environment"`; Amazon `sync_live: false`, `fields = { seller_id, marketplace_id }`; Shopify `fields = { shop_domain, location_id }`; WooCommerce `fields = { site_url, consumer_key_set }`.
- `POST` body: `{ marketplace, sales_channel_id, display_name?, ...fields }`. Behaviour: create the row; if the merged config is complete → run the live test (shopify/woo) → on pass save + `manager.apply(id)` (status `connected`), on fail save the credentials with status `error` and `last_error`, do not apply; Amazon: save, status `disconnected`... with `sync_live: false` and no test/apply; incomplete → row only, `disconnected`. Response `200 { ok, connection, test: { ok, message? } | null }`; never 422 for a failed test.
- `PUT /:id` (edit): merge with stored (blank keeps); if the connection is currently `connected` and the new test fails → `422 { error: "test_failed", message }` with nothing changed; otherwise save and apply as in create. `DELETE /:id`: `manager.stop(id)` then `clearConnectionById`; returns `{ ok: true }`. `/:id/test`: stored credentials, 409 `not_configured` when none; writes `connected` only when the manager has a live runtime for the id; on failure writes `error`. `/:id/link`: 409 `not_running` without a runtime. Legacy (read-only) ids reject PUT/DELETE with 400 `read_only`. Unknown id → 404.

- [ ] **Step 1: Failing tests:** `create with good credentials stores, applies and returns connected`; `create with a failing test still stores the credentials with status error and applies nothing`; `create with incomplete fields stores only the row as disconnected and runs no test`; `create amazon stores credentials, status disconnected, sync_live false, and calls neither the tester nor the manager`; `create rejects a sales channel that already has a connection (400 invalid_input)`; `edit of a connected connection with failing test returns 422 and changes nothing`; `edit of a non-connected connection saves regardless`; `blank secret on edit keeps the stored value`; `delete stops, clears credentials, keeps the sales channel link`; `list never contains any secret value (assert on the serialized JSON)`; `legacy row is read_only`; `unknown id is 404`; `webhook_url includes the id`; `401 without the bearer secret`.
- [ ] **Step 2: Run** `npx vitest run src/internal` — FAIL.
- [ ] **Step 3: Implement.** Reuse `readJsonBody`, `stringKeys` (add `display_name`, `seller_id`, `marketplace_id`, `refresh_token`, `marketplace`), `send`; keep error handling and the constructor-name-only logging.
- [ ] **Step 4: Run** internal tests + the full seller-hub suite + `npx tsc --noEmit` — PASS (known flakes aside).
- [ ] **Step 5: Commit** `feat(seller-hub): id-based connections API that saves without a passing test`.

---

### Task 5: seller-hub wiring, end-to-end test, docs

**Files:**
- Modify: `apps/seller-hub/src/index.ts`, `apps/seller-hub/README.md`, `apps/seller-hub/.env.example`
- Modify: `apps/seller-hub/src/connectors/connections.e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4. `index.ts`: legacy Amazon account lookup becomes `WHERE marketplace = 'amazon' AND managed = false`; the webhook server gets `connectors: { get: (m, id) => ..., all: (m) => ... }` built from `manager`; the internal handler is mounted as before.

- [ ] **Step 1: Failing e2e tests** (fake Shopify/Woo servers, real pool against the test DB as in the existing e2e): `two shopify connections sync independently (separate queues and listings)`; `bad credentials save the channel link with status error and start nothing`; `restart (applyAll) brings back every saved connection`; `legacy env connection and its old webhook URL keep working with no managed row`; `disconnect stops only that connection`.
- [ ] **Step 2: Run** `npx vitest run src/connectors/connections.e2e.test.ts` — FAIL.
- [ ] **Step 3: Implement** the `index.ts` wiring and update README (new routes, webhook URL format, legacy behaviour) and `.env.example` comments.
- [ ] **Step 4: Run** full seller-hub suite and `npx tsc --noEmit` — PASS (known flakes aside).
- [ ] **Step 5: Commit** `feat(seller-hub): wire many connections into startup and docs`.

---

### Task 6: backend workflow, routes, delete guard; remove the standalone page

**Files:**
- Create: `apps/backend/src/workflows/create-marketplace-sales-channel.ts`, `apps/backend/src/workflows/steps/link-sales-channel-stock-and-products.ts`, `apps/backend/src/api/admin/marketplace-connections/[id]/{route.ts,test/route.ts,link/route.ts}`, `apps/backend/src/api/admin/sales-channels/guard.ts` (middleware)
- Modify: `apps/backend/src/api/admin/marketplace-connections/{route.ts,middlewares.ts,seller-hub-client.ts,respond.ts}`, `apps/backend/src/api/middlewares.ts`
- Remove: `apps/backend/src/api/admin/marketplace-connections/[marketplace]/`, `apps/backend/src/admin/routes/marketplace-connections/`
- Test: `apps/backend/src/api/admin/marketplace-connections/__tests__/` (rewrite), `apps/backend/src/workflows/__tests__/create-marketplace-sales-channel.unit.spec.ts`, `apps/backend/src/api/admin/sales-channels/__tests__/guard.unit.spec.ts`

**Interfaces:**
- Consumes: Task 4's API. Reuse `callSellerHub` (`save`/`link` 120 s, `test` 30 s, default 15 s).
- Produces `createMarketplaceSalesChannelWorkflow` (input `{ name, description?, is_disabled? }` → `{ id, name }`): `createSalesChannelsWorkflow`, then link the stock locations and all products, porting the logic of `src/scripts/setup-shopify-channel.ts` (the scripts stay).
- Routes (admin auth, Zod `strictObject`):
  - `POST /admin/marketplace-connections` body `{ marketplace: "shopify"|"woocommerce"|"amazon", name, description?, is_disabled?, display_name?, ...fields }` → create channel via workflow, then `POST /internal/connections` with `sales_channel_id`. Response `200 { sales_channel: { id, name }, connection: View | null, test: {ok,message?} | null, connection_status: "connected"|"error"|"disconnected"|"unavailable" }`. Seller-hub unreachable → channel kept, `connection: null`, `connection_status: "unavailable"`, a `message`. Never log bodies.
  - `GET /admin/marketplace-connections` (optional `?sales_channel_id=`), `POST /admin/marketplace-connections/:id` (forwards PUT; 422 `test_failed` passed through), `DELETE /:id`, `POST /:id/test`, `POST /:id/link`.
  - Guard middleware on `DELETE /admin/sales-channels/:id`: ask seller-hub for a connection linked to that channel; if one exists (any status) reject with 400 "Disconnect the marketplace before deleting this sales channel". If seller-hub is unreachable the delete is allowed.

- [ ] **Step 1: Failing tests:** `create returns connected when seller-hub reports ok`; `create keeps the channel and returns error status when the test failed`; `create keeps the channel and returns unavailable when seller-hub is down`; `create with an unknown marketplace is 400`; `request bodies are never logged`; `edit passes 422 test_failed through unchanged`; `delete guard blocks a channel with a connection`; `delete guard allows a channel with none`; `delete guard allows deletion when seller-hub is unreachable`; `workflow creates the channel and links stock locations and products`.
- [ ] **Step 2: Run** `cd apps/backend && yarn test:unit -- marketplace-connections create-marketplace-sales-channel guard` — FAIL.
- [ ] **Step 3: Implement**, then delete the old page and `[marketplace]` routes and their tests.
- [ ] **Step 4: Run** `yarn test:unit`, `npx tsc --noEmit`, `npx medusa lint` — PASS.
- [ ] **Step 5: Commit** `feat(backend): create sales channels with marketplace connections and guard deletion`.

---

### Task 7: dashboard — marketplace picker on the create form

**Files:**
- Create: `packages/admin/dashboard/src/routes/sales-channels/components/marketplace-fields/{index.ts,registry.ts,marketplace-fields.tsx,marketplace-picker.tsx}`, `packages/admin/dashboard/src/hooks/api/marketplace-connections.tsx`
- Modify: `…/sales-channel-create/components/create-sales-channel-form/create-sales-channel-form.tsx`, the dashboard `en.json` (find it under `src/i18n/translations/`), `packages/admin/dashboard/src/lib/query-key-factory.ts` if the factory pattern requires it
- Test: `packages/admin/dashboard/src/routes/sales-channels/components/marketplace-fields/__tests__/marketplace-fields.spec.tsx`, `…/create-sales-channel-form/__tests__/create-sales-channel-form.spec.tsx`

**Interfaces:**
- Produces `registry.ts`: `MarketplaceType = "none" | "shopify" | "woocommerce" | "amazon"` and `MARKETPLACES: Record<Exclude<MarketplaceType,"none">, { label: string; fields: FieldDef[]; syncLive: boolean }>` with `FieldDef = { name: string; label: string; secret: boolean; required: boolean; help?: string; placeholder?: string; defaultValue?: string }`. Fields (snake_case keys sent to the backend): Shopify `shop_domain`, `access_token`(secret), `webhook_secret`(secret), `location_id`; WordPress `site_url`, `consumer_key`, `consumer_secret`(secret), `webhook_secret`(secret); Amazon `seller_id`, `marketplace_id`(default `ATVPDKIKX0DER`), `refresh_token`(secret).
- Produces hooks in `marketplace-connections.tsx` (use the neighbouring hooks' `useMutation`/`useQuery` + `sdk.client.fetch` style): `useCreateMarketplaceSalesChannel()`, `useMarketplaceConnection(salesChannelId)`, `useSaveMarketplaceConnection(id)`, `useTestMarketplaceConnection(id)`, `useLinkMarketplaceConnection(id)`, `useDisconnectMarketplaceConnection(id)`; types mirror the connection view from Task 4.
- Create form: a card/radio picker "No marketplace | Shopify | WordPress | Amazon" above the existing fields; choosing one renders its fields (secret fields are `type="password"`). Amazon shows "Saved — sync not live yet". With "No marketplace" the submit path is the existing `useCreateSalesChannel` unchanged. With a marketplace it calls `useCreateMarketplaceSalesChannel`, then navigates to the new channel; toast: success when `connected`; a warning "Channel saved, connection failed: <message>" when `error`; "Channel saved, connection not stored (seller-hub unreachable)" when `unavailable`; neutral "Channel saved. Add credentials later" when `disconnected`. Empty required marketplace fields do not block saving.

- [ ] **Step 1: Failing tests:** `picker shows no marketplace fields by default`; `choosing Shopify shows its four fields and hides others`; `secret fields render as password inputs`; `switching marketplace clears the previous fields`; `Amazon shows the sync-not-live note`; `submit with No marketplace calls the plain create`; `submit with a marketplace calls the marketplace create with snake_case fields`; `each connection_status shows the matching toast`; `empty marketplace fields still submit`.
- [ ] **Step 2: Run** `cd packages/admin/dashboard && yarn test src/routes/sales-channels` — FAIL.
- [ ] **Step 3: Implement** registry-driven rendering (one component renders any `FieldDef[]`), the hooks and the form changes; add `en.json` keys.
- [ ] **Step 4: Run** `yarn test src/routes/sales-channels`, `yarn typecheck`, `yarn lint` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): marketplace picker on the sales channel create form`.

---

### Task 8: dashboard — "Marketplace connection" section on the detail page

**Files:**
- Create: `…/sales-channel-detail/components/sales-channel-marketplace-section/{index.ts,sales-channel-marketplace-section.tsx}`, `…/sales-channel-detail/components/marketplace-edit-drawer.tsx`
- Modify: `…/sales-channel-detail/sales-channel-detail.tsx`, `en.json`
- Test: `…/sales-channel-marketplace-section/__tests__/sales-channel-marketplace-section.spec.tsx`

**Interfaces:**
- Consumes: Task 7 hooks and registry.
- Behaviour: the section is hidden when the channel has no connection and no one has asked to add one; otherwise shows type, status badge, last sync, linked listings, latest error, non-secret fields, the webhook URL (copyable), and actions Edit credentials (drawer rendering the registry fields with secret inputs empty and a "Stored" hint), Test, Link products by SKU, Disconnect (confirmation prompt). A channel with no connection shows "Connect a marketplace" opening the same fields. Each action disables its button while running; a 422 `test_failed` on edit shows the message and says the working connection was left unchanged. Amazon shows "Saved — sync not live yet" and disables Test/Link. Legacy (`read_only`) connections show status only.

- [ ] **Step 1: Failing tests:** `shows status, linked listings, last error and webhook url`; `secret inputs are empty and show the stored hint`; `Edit saves through the save hook and shows a 422 message`; `Test, Link and Disconnect call their hooks and disable while running`; `Disconnect asks for confirmation`; `Amazon disables Test and Link`; `legacy connection is read-only`; `a channel without a connection offers Connect`.
- [ ] **Step 2: Run** `yarn test src/routes/sales-channels` — FAIL.
- [ ] **Step 3: Implement** and mount the section in the detail page below the general section.
- [ ] **Step 4: Run** `yarn test`, `yarn typecheck`, `yarn lint` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): marketplace connection section on the sales channel page`.

---

### Task 9: full verification and hand-off notes

**Files:** none created; fix anything the checks surface in the owning task's files.

- [ ] **Step 1:** `cd apps/seller-hub && npx tsc --noEmit && npx vitest run` — PASS (known flakes aside).
- [ ] **Step 2:** `cd apps/backend && npx tsc --noEmit && npx medusa lint && yarn test:unit` — PASS.
- [ ] **Step 3:** `cd packages/admin/dashboard && yarn test && yarn build` — PASS (the build refreshes `dist`, which the backend serves). Do not start or restart any server.
- [ ] **Step 4:** Grep the diff for secret leaks: no new `console.*` call interpolates a credential, token or secret; no response builder reads a secret column.
- [ ] **Step 5:** Write a short hand-off note (not committed): env vars to set (`SELLER_HUB_INTERNAL_SECRET`, `SELLER_HUB_INTERNAL_URL`, optional `SELLER_HUB_PUBLIC_URL`), the restart order (seller-hub, then backend), and the manual check list for the owner (create a channel with each marketplace type; a failing credential still saves the channel; edit; disconnect).
- [ ] **Step 6: Commit** only if fixes were needed: `chore: fixes from final verification`.
