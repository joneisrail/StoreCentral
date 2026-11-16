# Per-channel pricing and inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A price and a stock number per variant per sales channel, edited in a grid, pushed to marketplaces per channel, with received purchases split equally across channels.

**Architecture:** A new Medusa module `channelOffers` holds per-channel price/stock and an idempotent movement log; Medusa's available stock stays the physical total. Pure rule functions (split, re-split, trim) are unit-tested; workflows apply them under a per-variant lock. Backend emits per-channel events, seller-hub pushes only that channel's values. A new dashboard page edits the grid.

**Tech Stack:** Medusa v2 (modules, workflows, subscribers, admin routes, Zod v4 from `@medusajs/framework/zod`), Postgres, seller-hub (BullMQ, pg), dashboard fork (React, react-query, react-i18next, vitest).

**Spec:** `docs/superpowers/specs/2026-11-17-channel-pricing-inventory-design.md` (binding; read it first).

## Global Constraints

- Module name `channelOffers` (camelCase). Admin routes use GET/POST/DELETE only; mutations run as workflows; Zod from `@medusajs/framework/zod` with `z.strictObject`.
- Follow the `order-events` module (`apps/backend/src/modules/order-events`) for module, model, migration (`npx medusa db:generate channelOffers`) and integration-test conventions.
- Dashboard: strings via `en.json` plus `yarn i18n:schema`; hooks in `src/hooks/api`, invalidate related query keys; reuse the tab-table pieces (`use-tab-table-query`, `tab-table-toolbar`) where they fit.
- Stock is never negative; the sum of a variant's channel stock never exceeds Medusa's available stock.
- No real Shopify/WooCommerce/Amazon calls; fakes only. Never run the migration, the split script or setup scripts against the dev database (the controller does that). Do not start/restart the dev server. Do not push or merge.
- Best-effort side effects (events to seller-hub) never fail a Medusa action; logs carry ids only, no secrets.
- Subagents run on Sonnet 5.5.

## Review Focus

- Applying the same order/cancel/receipt twice changes stock once (movement refs).
- Sum of channel stock never exceeds available stock after any path (edit, order, cancel, receipt, trim, concurrent requests).
- Each marketplace receives only its own channel's price and stock.
- Variant with no offer row, channel with no connection, variant with no listing: clear result, no crash, nothing pushed.
- Odd remainders: split of 7 over 3 channels is 3/2/2 in a fixed order; split of 0 and of fewer units than channels is correct.
- Seller-hub or Redis down: Medusa actions still succeed.

---

## Phase 1 — Backend module, rules, hooks

### Task 1: Pure stock rules

**Files:** Create `apps/backend/src/modules/channel-offers/rules.ts`; Test `apps/backend/src/modules/channel-offers/__tests__/rules.unit.spec.ts`

**Interfaces:**
- Produces:
  - `splitEqually(total: number, channelIds: string[]): Record<string, number>` — `floor(total/n)` each, the `total % n` extra units one at a time to the first channels in the given order; `{}` for no channels.
  - `resplitPool(stocks: Record<string, number>, channelIds: string[]): Record<string, number>` — splitEqually of the sum.
  - `deduct(stocks, channelId, qty): Record<string, number>` — channel stock minus qty, floored at 0.
  - `trimToTotal(stocks, total, order?): { stocks: Record<string, number>; trimmed: Record<string, number> }` — no change when sum ≤ total; otherwise removes units one at a time from the channel with the most stock (ties: earlier in `order`) until sum = total.

- [ ] Step 1: Write failing tests: split of 7 over [a,b,c] = {a:3,b:2,c:2}; 2 over 3 = {a:1,b:1,c:0}; 0 = zeros; no channels = {}; resplit of {a:8,b:10,c:10} = {a:10,b:9,c:9}; deduct never below 0; trim {a:5,b:3,c:3} to total 8 = {a:2,b:3,c:3} with `trimmed` = {a:3} (a drops to 3, then the three-way tie goes to a); trim with sum ≤ total unchanged.
- [ ] Step 2: Run, expect FAIL. Step 3: Implement as pure functions (no I/O). Step 4: Run, expect PASS.
- [ ] Step 5: Commit `feat(backend): channel stock rules`.

### Task 2: Module, models, service, migration

**Files:** Create `modules/channel-offers/{index.ts,service.ts,models/channel-offer.ts,models/channel-stock-movement.ts}`, generated migration; register in `apps/backend/medusa-config.ts`; Test `modules/channel-offers/__tests__/channel-offers-service.integration.spec.ts` (module integration test runner like order-events').

**Interfaces:**
- Models exactly as the spec's Data model (`channel_offer`, `channel_stock_movement`, unique indexes; price numeric nullable, stock int default 0).
- Produces on `ChannelOffersModuleService`: 
  - `ensureOffers(variantIds: string[], channelIds: string[]): Promise<void>` — creates missing rows (stock 0, price null), never touches existing.
  - `listForVariant(variantId: string): Promise<ChannelOfferRecord[]>` ordered by channel creation order (store `channel_order` int on the row set at creation, ascending).
  - `applyMovement(m: { kind; variant_id; sales_channel_id; delta: number; ref?: string }): Promise<boolean>` — returns false (no change) when a row with the same (`kind`,`ref`,`variant_id`,`sales_channel_id`) exists; otherwise inserts the movement (the caller sets the stock).
  - `setStocks(variantId: string, stocks: Record<string, number>): Promise<void>`; `setPrice(variantId, channelId, price: number | null)`; `markSync(variantId, channelId, { state, error?, price?, stock? })`.
  - `MOVEMENT_KINDS`, type `ChannelOfferRecord`.
- `ChannelOfferRecord = { id, variant_id, sales_channel_id, price: number | null, stock: number, last_synced_price, last_synced_stock, last_synced_at, sync_state, last_error, channel_order }`.

- [ ] Step 1: Write failing integration tests: ensureOffers idempotent; two channels ordered; applyMovement second call with the same ref returns false; setStocks/markSync persist.
- [ ] Step 2-4: implement, `npx medusa db:generate channelOffers`, run tests. Do not run `db:migrate`.
- [ ] Step 5: Commit `feat(backend): channel offers module`.

### Task 3: Settings (shared-stock switch)

**Files:** Create `api/admin/channel-stock-settings/{route.ts,middlewares.ts}`, `workflows/update-channel-stock-settings.ts`, `modules/channel-offers/settings.ts`; register middlewares; Test route integration spec.

**Interfaces:**
- Produces `readShareStockSetting(container): Promise<boolean>` (default false) and the routes `GET /admin/channel-stock-settings -> { share_stock_after_sale: boolean }`, `POST` body `z.strictObject({ share_stock_after_sale: z.boolean() })`.
- Storage: follow how the order-page "high-value threshold" setting is stored (find it first; reuse that mechanism). If none fits, use `store.metadata.share_stock_after_sale` via `updateStoresWorkflow`.

- [ ] Step 1: failing integration test (default false, POST then GET true, rejects non-boolean and unknown keys, unauthenticated 401). Steps 2-4 implement/pass. Step 5: commit.

### Task 4: Edit workflow and route

**Files:** Create `workflows/update-channel-offer.ts`, `workflows/steps/{validate-channel-offer-edit.ts,apply-channel-offer-edit.ts}`, `api/admin/channel-offers/[variant_id]/[channel_id]/route.ts`, middlewares; Test unit specs for steps + integration spec.

**Interfaces:**
- Consumes: Task 1, 2 (+ available stock via the inventory module: sum of `stocked_quantity - reserved_quantity` over the variant's inventory levels; reuse the same read the seller-hub `inventory_quantity` uses).
- Produces: `updateChannelOfferWorkflow` input `{ variant_id, channel_id, price?: number | null, stock?: number }`; validates `stock` is an integer ≥ 0 and `sum(other channels) + stock ≤ available` (error message includes the free units); price must be ≥ 0 or null; unknown channel → 404; a `edit` movement is recorded; sets `sync_state: "pending"`; runs under the variant lock key `channel-offers:<variant_id>`; emits `channel-offer.changed` `{ variant_id, sales_channel_id, kind: "stock" | "price" | "both", manual: true }` (consumed in Task 13). Route `POST` body `z.strictObject({ price: z.number().nonnegative().nullable().optional(), stock: z.number().int().nonnegative().optional() })`, refine at least one key.

- [ ] Step 1: failing tests (over-allocation rejected with free-unit count, negative rejected, price null allowed, concurrent edits cannot exceed the total, movement + pending state written, 404 channel). Steps 2-4. Step 5 commit.

### Task 5: Orders and cancels apply to channel stock

**Files:** Create `workflows/apply-order-to-channel-stock.ts`, `subscribers/channel-stock-orders.ts` (events `order.placed` and `order.canceled`); Test unit + integration.

**Interfaces:**
- Consumes: Tasks 1-3. **First sub-step (prove with a failing test before coding):** an order placed through seller-hub's import path and through the admin carries `sales_channel_id`, and the line items carry `variant_id`; record in the test where each is read (`query.graph` on `order` with `items.variant_id`, `sales_channel_id`).
- Produces: `applyOrderToChannelStockWorkflow({ order_id, mode: "placed" | "canceled" })`: for each line with a `variant_id` and a managed inventory item, lock the variant, then (placed) `deduct` that line's quantity from the order's channel, (canceled) add it back; when the switch is on, `resplitPool` over all channels; movement `kind: "order" | "cancel"`, `ref: <line item id>`; a line already applied is skipped; orders with no `sales_channel_id` or no offer rows are skipped with a log; emits `channel-offer.changed` `{ ..., kind: "stock" }` for every channel whose stock changed. The subscriber is best-effort (logs ids only).

- [ ] Step 1: failing tests (deduct only that channel with switch off; re-split with switch on e.g. {10,10,10} sell 2 on a → {10,9,9}... verify 28 → 10,9,9; floor at 0; cancel restores; a second delivery of the same event changes nothing; order without channel skipped). Steps 2-4. Step 5 commit.

### Task 6: Purchase receipt splits across channels

**Files:** Create `workflows/steps/split-received-stock-across-channels.ts`; Modify `workflows/receive-purchase-goods.ts` (after `adjustInventoryLevelsStep`); Test unit + extend the existing receive workflow tests.

**Interfaces:**
- Consumes: Tasks 1-2, `recorded.receipt` (items with `purchase_item_id`, `quantity`) mapped to variants through the purchase items (find the field, e.g. `variant_id`/`inventory_item_id`, in `modules/purchase`).
- Produces: step input `{ receipt_id: string, lines: { variant_id: string; quantity: number }[] }`; for each line, under the variant lock, `splitEqually(quantity, channelIds)` added to each channel's stock (`kind: "receipt"`, `ref: receipt_id`), idempotent by movement; compensation subtracts what it added (never below 0). Emits `channel-offer.changed` with `kind: "stock"`. If no offer rows exist for a variant, `ensureOffers` first.

- [ ] Step 1: failing tests (receive 7 over 3 channels = +3/+2/+2; two receipts accumulate; compensation restores; step failure inside the workflow does not leave stock added to channels while Medusa stock was not adjusted — order the step last so a failure before it leaves everything untouched). Steps 2-4. Step 5 commit.

### Task 7: Keep rows and totals consistent (subscribers)

**Files:** Create `subscribers/channel-offers-ensure.ts` (`product-variant.created`, `sales-channel.created`), `subscribers/channel-stock-trim.ts` (`inventory-level.updated`), `workflows/trim-channel-stock.ts`; Test unit.

**Interfaces:**
- ensure: creates offer rows for the new variant across all channels, or for all variants for a new channel (stock 0, price null; a new channel never takes stock from others).
- trim: resolve the variant of the changed level, read the available total; if `sum(channel stock) > total`, apply `trimToTotal` with `kind: "trim"` movements (`ref` = level id + timestamp bucket is not needed; trim is naturally idempotent) and emit `channel-offer.changed` stock events for trimmed channels. Increases leave stock unallocated.

- [ ] Step 1: failing tests (trim largest first; no-op when within total; ensure creates exactly the missing rows). Steps 2-4. Step 5 commit.

### Task 8: Grid read route

**Files:** Create `api/admin/channel-offers/route.ts` (GET), `api/admin/channel-offers/query.ts`, middlewares; Test integration spec.

**Interfaces:**
- `GET /admin/channel-offers?q&order&limit&offset&channel_ids` where `order` ∈ `name|total|unallocated|<channel_id>:stock|<channel_id>:price` with optional `-` prefix for descending. Response `{ rows: [{ variant_id, product_id, product_title, variant_title, sku, base_price, available, unallocated, channels: { [channel_id]: { price: number | null, effective_price: number, stock, sync_state, last_synced_at, last_error, has_connection: boolean } } }], channels: [{ id, name, kind: "marketplace" | "web" | "pos" | "other", has_connection }], count }`. Search matches product title, variant title, SKU (wildcard-literal handling as in `order-search/search.ts`: never put raw `%`/`_` into a pattern). `limit` max 100. Web store and POS `effective_price` is always the base price. `has_connection` comes from seller-hub's connection list (reuse `marketplace-connections` client); if seller-hub is unreachable, all `false`, never an error.

- [ ] Step 1: failing tests (search by title and SKU, wildcard characters literal, sort by a channel's stock asc/desc, paging count, unallocated math, web store price read-only = base, seller-hub down). Steps 2-4. Step 5 commit.

### Task 9: One-time split script

**Files:** Create `apps/backend/src/scripts/split-existing-stock.ts`; Test unit on its pure planner.

**Interfaces:** export `planInitialSplit(variants: { variant_id: string; available: number; existing: Record<string, number> }[], channelIds: string[]): { variant_id: string; stocks: Record<string, number> }[]` (variants with any existing channel stock are skipped, so it is idempotent) and a `medusa exec` default function that applies it with `kind: "rebalance"` movements and emits no marketplace events. The build never executes the default function.

- [ ] Step 1-4 TDD on `planInitialSplit` (skip when already split; remainder rule). Step 5 commit.

## Phase 2 — Dashboard

### Task 10: Hooks, route and read-only grid

**Files:** Create `hooks/api/channel-offers.tsx` (`channelOffersQueryKeys`, `useChannelOffers(params)`, `useChannelStockSettings`, `useUpdateChannelStockSettings`), `routes/products/channel-pricing/{index.ts,channel-pricing.tsx,components/channel-grid.tsx}`; Modify `dashboard-app/routes/get-route.map.tsx` (path `/products/channel-pricing`, breadcrumb), the products list header (link "Channel stock & pricing"), `en.json`, `$schema.json`; Test `channel-grid.spec.tsx`.

**Interfaces:** consumes Task 8's response shape. Page: search box (debounced, URL param `q`), sort dropdowns (same options as the mockup: name, total, unallocated, each channel's stock and price; asc/desc; default total ascending), paging, channel show/hide chips (URL-persisted), per-channel Price | Stock | sync columns, total and unallocated per row.

- [ ] Step 1: failing tests (columns follow the channels in the response, hidden channel chip removes its columns, search and sort send the right query, empty state, error state with retry). Steps 2-4. Step 5 commit.

### Task 11: Inline editing, amber state, sync icon

**Files:** Modify `channel-grid.tsx`; Create `components/editable-cell.tsx`, hooks `useUpdateChannelOffer`, `useSyncChannelOffer` in `hooks/api/channel-offers.tsx`; Tests `editable-cell.spec.tsx`.

**Interfaces:** `POST /admin/channel-offers/:variant/:channel` (Task 4) and `POST .../sync` (Task 12). Cell: pencil on hover (and on keyboard focus), Enter saves, Esc cancels, numeric validation; edited/pending cells amber with the previous synced value struck through; sync icon only when `has_connection`, else "live"; red state shows `last_error` with a retry; server rejection (over-allocation) shown inline with the free-unit count; successful edits invalidate `channelOffersQueryKeys.all`.

- [ ] Step 1: failing tests (Enter saves, Esc cancels, over-allocation message, pending style, sync icon hidden without connection, sync click calls the route and shows busy then refreshes). Steps 2-4. Step 5 commit.

### Task 12: Settings switches in the UI

**Files:** Modify the sales channel settings page (order-page settings area) and the channel page's "Marketplace connection" section; `en.json`; Tests alongside existing specs.

**Interfaces:** the shared-stock switch reads/writes Task 3's routes. The per-connection "Auto-sync prices" switch reads/writes a new boolean `auto_sync_price` on the connection through the existing marketplace-connection update route (Task 14 adds the column and field).

- [ ] Steps 1-5 TDD (toggle sends the right payload, shows saved state, error toast). Commit.

## Phase 3 — Sync

### Task 13: Per-channel events and the sync route

**Files:** Modify `subscribers/seller-hub-sync.ts` and its unit spec; Create `api/admin/channel-offers/[variant_id]/[channel_id]/sync/route.ts`, `api/admin/channel-offers/[variant_id]/[channel_id]/push-values/route.ts`, `workflows/request-channel-sync.ts`; Tests.

**Interfaces:**
- New subscriber on `channel-offer.changed`: forwards `POST {SELLER_HUB_WEBHOOK_URL}/webhooks/medusa` with `{ event: "channel-offer.changed", data: { variant_id, sales_channel_id, kind, force } }` (best-effort, same error handling as today). Stock changes always forward; price changes forward only when `force` is true (sync icon) or the connection's `auto_sync_price` is true (seller-hub checks that flag).
- The old variant-level forwarding (`inventory-level.updated`, `product-variant.updated`) is kept only for variants that have **no** offer rows (so nothing regresses before the one-time split); for variants with offer rows it is dropped.
- `POST .../sync` → body none; emits the event with `kind: "both"`, `force: true`; returns `{ queued: true }`, or 400 with a message when the channel has no connection.
- `GET .../push-values` (read by seller-hub with its admin credentials) → `{ price: number | null, effective_price: number, stock: number }`.
- `POST .../sync-result` body `{ state: "synced" | "failed", error?: string, price?: number, stock?: number }` → `markSync`; validates strictly; error text truncated to 500 chars.

- [ ] Step 1: failing tests (events shape, price not forwarded without force/auto, legacy path kept for offerless variants, sync route 400 without a connection, sync-result updates state). Steps 2-4. Step 5 commit.

### Task 14: Seller-hub per-channel push

**Files (seller-hub):** Modify `webhook/server.ts` (`routeEvent`: new `channel-offer.` prefix), `db/schema.ts` (add `auto_sync_price BOOLEAN NOT NULL DEFAULT false` to `integration_account`), `medusa/admin-client.ts` (`getChannelPushValues(variantId, channelId)`, `reportChannelSyncResult(...)`), the Shopify/WooCommerce/Amazon push processors (`shopify-push-inventory.ts`, `shopify-push-price.ts`, `woocommerce-push-*.ts`, Amazon `push-*.ts`), connection bootstrap files, the marketplace-connection update route that stores `auto_sync_price`; Tests next to each.

**Interfaces:**
- `routeEvent` for `channel-offer.changed`: find the live connection whose `medusa_sales_channel_id` equals `data.sales_channel_id`; none → ignore with a log. Enqueue on that connection's own inventory and/or price queue a job `{ variantId, salesChannelId }` with `jobId` `channel-<kind>-<variantId>-<channelId>` (coalescing; `removeOnComplete`). A `price` kind without `force` is dropped unless the connection's `auto_sync_price` is true.
- The push processors, for these jobs, read `getChannelPushValues` (own channel's stock and effective price, then the connection's `price_rule`), push, update `channel_listing.last_synced_*`, `sync_job`, and call `reportChannelSyncResult`; a variant with no listing on that connection reports `failed: "not listed"`; non-USD Shopify price stays a permanent failure; existing variant-level jobs keep working unchanged.
- Tests use the existing fake Shopify/Woo clients; Amazon unit-only as today.

- [ ] Step 1: failing tests (routes to the right connection only, another connection gets nothing, coalescing jobId, price dropped without force/auto, push uses channel values not variant total, failure reported, `price_rule` applied, no secrets in logs). Steps 2-4. Step 5 commit.

### Task 15: Regression, docs, verification

- [ ] Run backend `tsc`, `npx medusa lint`, unit and module integration suites; the integration specs for the new routes plus the existing order, receipt and sync specs; seller-hub `tsc` and suite; dashboard typecheck, eslint, vitest, `yarn i18n:schema`, `yarn build`. Expect only the 3 known pre-existing combobox failures in the dashboard.
- [ ] Update `apps/backend/src/subscribers/README.md`, `modules/README.md` and the seller-hub README (events, the `auto_sync_price` column, the one-time script and how to run it deliberately). Commit.
