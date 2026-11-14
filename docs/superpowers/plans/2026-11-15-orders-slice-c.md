# Orders Page Slice C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search by SKU / product / tracking number plus filters with chips on every Orders tab, and an order change history written by our workflows and shown on the order page.

**Architecture:** A new `order-events` custom module stores append-only events written best-effort by the hold / release / void / mark-shipped workflows, the EasyPost webhook (system events) and an `order.canceled` subscriber. A backend `GET /admin/order-search` route returns up to 200 matching order ids; the dashboard's tab tables add a shared toolbar (search + filter bar + chips) and request `GET /admin/orders` with `id: { $in }` plus their own tab params. The order Activity timeline merges events from `GET /admin/orders/:id/events`.

**Tech Stack:** Medusa v2 custom module + workflows + admin routes (`apps/backend`, jest + integration specs on local Postgres), the dashboard fork (`packages/admin/dashboard`, vitest, react-query, react-i18next).

**Spec:** `docs/superpowers/specs/2026-11-15-orders-slice-c-design.md` (from `docs/superpowers/specs/SRS-order-management-page.md`). Branch: `feat/orders-slice-c` from `master`.

## Global Constraints

- Medusa routes GET/POST/DELETE only; mutations through workflows (regular `function`, no async/await/conditionals/Date creation in the composition — `transform`/`when`; `.config({name})` on repeated steps); Zod from `@medusajs/framework/zod` (v4, `z.strictObject`). New module follows the layout of `apps/backend/src/modules/review` (`models/`, `migrations/`, `service.ts` using `MedusaService`, `index.ts` with `Module(...)`), registered in `apps/backend/medusa-config.ts`, module name camelCase.
- Event payloads and logs never contain tracking numbers, URLs, emails, addresses or any credentials beyond what the spec lists (hold reason, carrier, tracking number are shown to staff only in the events route response — the module stores them; logs never).
- Dashboard strings via `t()` + `en.json` + `yarn i18n:schema`; each new component in its own file; counts stay independent of the search box and filters.
- Existing Slice A/B behaviour and tests keep passing. Known unrelated failures: 3 in `src/components/inputs/combobox/__tests__/combobox.spec.tsx`; flaky `apps/seller-hub/src/medusa/admin-client.test.ts`; a slow spec may time out under load — rerun alone before treating as real.
- Do not start or restart any dev server; do not push or merge; never `git add` anything under `.superpowers`. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Rebuild `packages/core/core-flows` first if you change it (git-ignored build).

## Review Focus

- Search/filters can only narrow a tab, never widen it; held orders never appear in Ready to Ship through search; no SQL injection or wildcard abuse via `q`; auth required.
- History is append-only, written for each of our state changes, a failed write never fails the business action, no secrets in logs; actor shown correctly (`system` vs user).
- Counts and table rows still agree; URL state per tab prefix does not leak between tabs.

---

### Task 1: `order-events` module

**Files:**
- Create: `apps/backend/src/modules/order-events/{index.ts,service.ts,models/order-event.ts,migrations/<generated>.ts}`, `apps/backend/src/modules/order-events/__tests__/order-events.unit.spec.ts`, `apps/backend/src/jobs/prune-order-events.ts`, `apps/backend/src/jobs/__tests__/prune-order-events.unit.spec.ts`
- Modify: `apps/backend/medusa-config.ts` (register `./src/modules/order-events`)

**Interfaces:**
- Produces: `ORDER_EVENTS_MODULE = "orderEvents"`; model `OrderEvent { id (prefix "oevt"), order_id: text, type: text, actor: text ("system" or an admin user id), old_value: json nullable, new_value: json nullable, created_at }` with index on `(order_id, created_at)`; service (`MedusaService({ OrderEvent })`) plus `recordOrderEvent(input: { order_id: string; type: OrderEventType; actor: string; old_value?: unknown; new_value?: unknown }): Promise<void>` and `listOrderEvents(orderId: string, limit = 200): Promise<OrderEventRecord[]>` (newest first) and `pruneOlderThan(date: Date): Promise<number>`; `OrderEventType = "order.held" | "order.released" | "order.label_voided" | "order.marked_shipped" | "order.canceled" | "order.shipped" | "order.delivered"`.
- Job `prune-order-events`: daily (`0 3 * * *`), deletes events older than 2 years, logs only the deleted count.

- [ ] **Step 1: Failing tests (red first):** `recordOrderEvent stores type/actor/old/new for an order`; `listOrderEvents returns newest first and caps at the limit`; `events of other orders are not returned`; `pruneOlderThan deletes only rows older than the cutoff and returns the count`; job: `deletes events older than two years` (mock service).
- [ ] **Step 2: Run** `cd apps/backend && yarn test:unit -- order-events prune-order-events` — FAIL.
- [ ] **Step 3: Implement** (model, service, index, migration generated with `npx medusa db:generate orderEvents` and committed; register in config; job).
- [ ] **Step 4: Run** the tests, `npx tsc --noEmit`, `npx medusa lint`, and apply the migration against the local test DB through the integration harness (`yarn test:integration:modules` or the repo's equivalent in package.json) — PASS. Do not run migrations against the dev DB.
- [ ] **Step 5: Commit** `feat(backend): order events module with 2-year retention job`.

---

### Task 2: Record events from our workflows + events route

**Files:**
- Create: `apps/backend/src/workflows/steps/record-order-event.ts`, `apps/backend/src/api/admin/orders/[id]/events/route.ts`, `apps/backend/src/subscribers/order-events-recorder.ts`
- Modify: `apps/backend/src/workflows/{hold-order,release-order,void-order-label,mark-order-shipped}.ts` (+ their steps where the old/new values are known), `apps/backend/src/api/webhooks/easypost/route.ts`, `apps/backend/src/api/admin/orders/middlewares.ts`
- Test: unit specs for the step, each workflow's recording, the route, the subscriber, the webhook; integration spec `integration-tests/http/order-events.spec.ts`

**Interfaces:**
- Consumes: Task 1's `recordOrderEvent` / `listOrderEvents`.
- Produces: `recordOrderEventStep` (input `{ order_id; type; actor; old_value?; new_value? }`, **best-effort**: catches every error, logs only `order_id` and `type` via the logger, never rethrows, no compensation); workflows add it as a LAST step with: hold → `order.held` new_value `{ reason }`; release → `order.released` old_value `{ reason }`; void → `order.label_voided` new_value `{ fulfillment_ids }`; mark shipped → `order.marked_shipped` new_value `{ carrier, tracking_number, fulfillment_id }`. The actor is the workflow's `user_id` input (hold, release, void and mark-shipped routes pass `req.auth_context?.actor_id`; add a `user_id` input to the void workflow and route again if it was removed — it can be `undefined` → actor `"unknown"`). EasyPost webhook: after it creates the shipment → `order.shipped` (actor `system`, new_value `{ fulfillment_id }` — resolve the order id with the existing `resolveOrderIdForFulfillment` helper from the seller-hub-sync subscriber), on delivered → `order.delivered` (system); both best-effort, never changing the webhook response. Subscriber `order-events-recorder.ts` listens to `order.canceled` (data `{ id }`) → `order.canceled` event with actor `"unknown"` (core's event carries no actor).
- Route `GET /admin/orders/:id/events` → `{ events: [{ id, type, actor: "system" | { id: string, name: string | null }, old_value, new_value, created_at }] }` (up to 200, newest first); `actor.name` from the user module (`Modules.USER`, `first_name last_name` or email local part; null when unknown/not found); 404 when the order does not exist.

- [ ] **Step 1: Failing tests:** step: `stores an event`, `swallows a failing service and logs only order id and type`; each workflow: `records exactly one event with the documented old/new values and the actor` and `a failing event write does not fail the action`; EasyPost webhook: `records order.shipped once on the creating update, none on repeats; order.delivered on delivered; emit/record failures keep 200`; subscriber: `order.canceled recorded`; route: `lists newest first with resolved actor names, system actor, unknown order 404, auth`.
- [ ] **Step 2: Run** the new specs — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** specs, `npx tsc --noEmit`, `npx medusa lint`, full `yarn test:unit` (slow; background + poll), integration specs `order-events`, `order-hold-release`, `order-void-label`, `order-mark-shipped`, `easypost-webhook` — PASS.
- [ ] **Step 5: Commit** `feat(backend): record order events from hold, release, void, ship and cancel`.

---

### Task 3: Backend order search route

**Files:**
- Create: `apps/backend/src/api/admin/order-search/route.ts`, `apps/backend/src/api/admin/order-search/middlewares.ts`, `apps/backend/src/api/admin/order-search/search.ts`
- Modify: `apps/backend/src/api/middlewares.ts` (spread the new middlewares)
- Test: `apps/backend/src/api/admin/order-search/__tests__/search.unit.spec.ts`, `…/route.unit.spec.ts`, `apps/backend/integration-tests/http/order-search.spec.ts`

**Interfaces:**
- Produces `GET /admin/order-search` with query (strict Zod, all optional but at least one required): `q` (trim, min 2, max 100), `sku` (min 1, max 100), `country` (2-letter), `carrier` (max 50), `ship_from` (stock location id), `delivery` (max 100). Response `200 { order_ids: string[]; truncated: boolean }` (max 200, newest orders first); `400` for invalid/empty input.
- Matching (all AND-combined across supplied params, case-insensitive partial matches; user text is escaped for LIKE wildcards `%`, `_`, `\`):
  - `q`: UNION of (a) the order module's own `q` search (same behaviour as `GET /admin/orders?q=`: `display_id`, `custom_display_id`, `email`, address text), (b) any order line item whose `variant_sku`, `title` or `product_title` matches, (c) any fulfillment label whose `tracking_number` matches.
  - `sku`: line item `variant_sku` matches.
  - `country`: shipping address `country_code` equals.
  - `carrier`: the fulfillment's `data.carrier` / `data.easypost_carrier` / `metadata.carrier` matches (case-insensitive equals).
  - `ship_from`: fulfillment `location_id` equals.
  - `delivery`: shipping method `name` matches.
- Implementation notes: use the Query graph / module services (no raw string-concatenated SQL; if raw SQL is unavoidable use parameter binding only). **First prove with failing integration tests which entities and fields exist** (order line item `variant_sku`/`title`/`product_title`, `fulfillment_label.tracking_number`, fulfillment `location_id`/`data`, `order_shipping_method.name`, shipping address `country_code`) and record the findings in the report; if a field is not queryable the way assumed, use the closest supported path and say so.
- Measure: add an integration test or a documented script run that times the `q` path against ~2,000 seeded orders and reports the time in the report (no assertion on speed).

- [ ] **Step 1: Failing tests (red first):** unit — param validation (min length, unknown keys, at least one param), escaping of `%`/`_`/`\`, union + AND combination, truncation flag at 200, ordering; integration — SKU match, product title match, tracking-number match, partial/case-insensitive, `country`, `carrier` (EasyPost `data.easypost_carrier` and manual `metadata.carrier`), `ship_from`, `delivery`, `q` equals the standard search for a customer email, no match → empty, auth required.
- [ ] **Step 2: Run** `yarn test:unit -- order-search` — FAIL.
- [ ] **Step 3: Implement** the pure search logic in `search.ts` (testable with a mocked query) and the route.
- [ ] **Step 4: Run** the specs, `npx tsc --noEmit`, `npx medusa lint`, full `yarn test:unit` (background + poll), integration spec `order-search` — PASS.
- [ ] **Step 5: Commit** `feat(backend): order search by SKU, product, tracking number and filters`.

---

### Task 4: Dashboard hooks and the shared tab-table toolbar

**Files:**
- Create: `packages/admin/dashboard/src/hooks/api/order-search.tsx`, `…/hooks/api/order-events.tsx`, `…/routes/orders/order-list/components/order-list-table/use-tab-table-query.ts`, `…/components/tab-table-toolbar.tsx`, `…/components/tab-filter-definitions.ts`
- Modify: `en.json` + `yarn i18n:schema`
- Test: specs beside each (`use-tab-table-query.spec.ts(x)`, `tab-table-toolbar.spec.tsx`, `order-search.spec.tsx`)

**Interfaces:**
- Produces `useOrderSearch(params: { q?; sku?; country?; carrier?; ship_from?; delivery? } , options?)` → `{ orderIds: string[] | null; truncated: boolean; isLoading; isError; refetch }` (disabled and `orderIds: null` when no param is active; `retry: false`; 30 s stale); `useOrderEvents(orderId)` → `{ events, isLoading, isError }` for Task 6.
- Produces `useTabTableQuery(prefix: string)` → `{ search: string; setSearch(value); filters: Record<string,string[]>; setFilter(key, values); removeFilter(key); clearAll(); activeSearchParams; toOrdersQuery(baseTabQuery): Record<string, unknown>; hasUserCriteria: boolean }` reading/writing URL params prefixed with the table's prefix (`${prefix}_q`, `${prefix}_f_<key>`); debounce 300 ms for search; `toOrdersQuery` merges user criteria into the tab query with **narrow-only** semantics: direct filters (`payment_status`, `fulfillment_status`) are intersected with the tab's own list (empty intersection → an impossible `id` filter so nothing is listed), `sales_channel_id`, `tag_id`, `region_id`, `created_at` (operator map `$gte/$lte`), `total` ranges are passed through, and search-route results become `id: { $in: orderIds }` intersected with the tab's own `id.$nin` held-exclusion (remove excluded ids from the `$in` list).
- Produces `TabTableToolbar` (search input with the placeholder from i18n, the existing data-table filter bar with chips, edit/remove, Clear all; reuse `components/table/data-table/data-table-filter` and the existing filter option hooks used by `useOrderTableFilters`) with filter definitions in `tab-filter-definitions.ts`: order date range, payment status, fulfillment status, sales channel, tags, region, country (select from a short list of ISO codes plus free 2-letter input), total range, carrier (UPS, FedEx, USPS, DHL, Other text), ship-from location (stock locations), delivery method (text), item SKU (text).
- Truncation notice: when the search result is `truncated`, the toolbar shows an inline "Showing the first 200 matches — refine the search" message.

- [ ] **Step 1: Failing tests (red first):** `useTabTableQuery` — URL round trip per prefix and no leakage between prefixes; debounce; payment-status intersection with the tab list (including the empty-intersection case); `id $in` minus held ids; `created_at`/`total` operator maps; `clearAll` and `removeFilter`; toolbar — renders search + chips, add/edit/remove chip, Clear all, truncation notice, error state with Retry, no request when only the tab params are active.
- [ ] **Step 2: Run** `cd packages/admin/dashboard && yarn test src/routes/orders src/hooks/api src/i18n` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `yarn typecheck`, `npx eslint <changed files> --max-warnings 0` (known react-refresh warning in `shipped-table.tsx` may remain) — PASS. No `yarn build` here.
- [ ] **Step 5: Commit** `feat(dashboard): search and filter toolbar for the order tab tables`.

---

### Task 5: Wire the toolbar into the tab tables

**Files:**
- Modify: `…/components/view-order-table.tsx` (Awaiting Payment, On Hold, Cancelled), `…/components/ready-to-ship-table.tsx`, `…/components/shipped-table.tsx` and their specs, `en.json`

**Interfaces:**
- Consumes: Task 4. Each table calls `useTabTableQuery(<its prefix>)` and, when `hasUserCriteria` is true, requests orders with `toOrdersQuery(getViewQuery(view, …))`; the counts hook is untouched (counts always use the tab's own `getViewQuery`). The search box and chips appear above each table; the pagination offset resets to 0 whenever the search or any filter changes. Ready to Ship keeps all its existing behaviour (rates, packages, bulk fulfill, selection pruning, hold exclusion): its request params change only through `toOrdersQuery`.

- [ ] **Step 1: Failing tests:** each table: `typing in the search box requests orders with id $in and without q`; `a filter chip narrows the tab query without widening it`; `no user criteria leaves the request identical to Slice B's`; `offset resets on criteria change`; `held ids never appear in Ready to Ship search results`; `tab counts do not change with the search`; Ready to Ship: `selection is pruned when search hides rows` (existing pruning keeps working).
- [ ] **Step 2: Run** `yarn test src/routes/orders` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, `yarn typecheck`, eslint on changed files — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): search and filters on every order tab`.

---

### Task 6: Order activity shows the change history

**Files:**
- Modify: `packages/admin/dashboard/src/routes/orders/order-detail/components/order-activity-section/{order-timeline.tsx,activity-items.tsx}`, `en.json`
- Create: `…/order-activity-section/order-event-items.tsx`
- Test: `…/order-event-items.spec.tsx`, extend the timeline spec if one exists

**Interfaces:**
- Consumes: Task 2's route via `useOrderEvents`. Merge the events into the timeline items sorted by time (newest first like the existing items). One-line summaries by type: held (reason), released, label voided, marked shipped ("via <carrier> <tracking number>"), canceled, shipped (system), delivered (system); actor shown as the user name or email-local-part, "System" for `system`, "Unknown" otherwise. Events load lazily with the section; failure shows the existing items plus a small "History unavailable" note; empty events change nothing.

- [ ] **Step 1: Failing tests:** `merges events with existing items by time`; each type's summary; actor display variants; `events error keeps the timeline and shows the note`; `no events renders unchanged`.
- [ ] **Step 2: Run** `yarn test src/routes/orders/order-detail` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, `yarn typecheck`, `yarn i18n:schema`, eslint — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): show order change history in the order activity`.

---

### Task 7: Full verification, search timing, hand-off

**Files:** none new; fix anything the checks surface in the owning task's files.

- [ ] **Step 1:** `cd apps/backend && npx tsc --noEmit && npx medusa lint && yarn test:unit`, then integration specs `order-events`, `order-search`, `order-hold-release`, `order-void-label`, `order-void-relabel`, `order-mark-shipped`, `easypost-webhook`, `bulk-fulfill-orders` — PASS (rerun slow failures alone).
- [ ] **Step 2:** `cd packages/admin/dashboard && yarn typecheck && yarn test` (only the 3 known combobox failures; confirm that directory is untouched), eslint on branch-changed files, `yarn build` (refreshes the served dist). No dev server started.
- [ ] **Step 3:** Report the measured search time from Task 3 and, if the `q` path exceeded 1 s at ~2,000 orders, add the `pg_trgm` index fallback as a backend migration script (documented, not auto-run) and say so.
- [ ] **Step 4:** Grep the branch diff for secret/PII logging (no `console.*`/logger lines interpolating tracking numbers, emails, addresses, reasons) and for leftover TODOs; confirm only intended areas changed.
- [ ] **Step 5:** Hand-off note (in the report, not committed): the migration must be applied (`npx medusa db:migrate`) before restarting the backend; restart backend; roles/permissions and tag-change events are deferred; manual checks (search a SKU and a tracking number on each tab, add a payment-status chip and see it narrow Ready to Ship, hold/void/mark-shipped and see the history lines on the order).
- [ ] **Step 6: Commit** only if fixes were needed: `chore: fixes from final verification`.
