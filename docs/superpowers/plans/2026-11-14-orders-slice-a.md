# Orders Page Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six order tabs with live counts, Hold/Release, alerts, and the missing Ready to Ship columns and row menu.

**Architecture:** Hold = reserved order tag `On hold` + `metadata.hold`, written by two backend workflows behind `POST /admin/orders/:id/hold|release`. The dashboard derives every tab from list-API filters (counts = `limit=1` queries), excludes held ids from Ready to Ship with the existing `id` operator filter (`$nin`), and computes alerts/due status client-side with pure functions.

**Tech Stack:** Medusa v2 workflows and admin routes (`apps/backend`, jest), the dashboard fork (`packages/admin/dashboard`: React, react-query, react-i18next, vitest), vendored `packages/medusa` validators.

**Spec:** `docs/superpowers/specs/2026-11-14-orders-slice-a-design.md` (from `docs/superpowers/specs/SRS-order-management-page.md`).

**Branch/execution note:** work on a new branch `feat/orders-slice-a` created from `master` once the marketplace work is finished (shared `en.json` would otherwise conflict), or in a separate git worktree.

## Global Constraints

- Medusa routes use only GET/POST/DELETE; mutations go through workflows (function composition, no async/await/conditionals outside `when`/`transform`); Zod from `@medusajs/framework/zod`.
- Dashboard strings go through `t()` with keys added to `packages/admin/dashboard/src/i18n/translations/en.json`; follow neighbouring component patterns and keep each new component in its own file.
- Existing Ready to Ship, Shipped, bulk fulfill and rate-quote behaviour is unchanged for orders that are not on hold; existing tests keep passing unchanged.
- No real carrier calls; no dev-server restarts; do not push or merge. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Ruling: held-order exclusion uses the existing `id` operator filter (`id: { $nin: [...] }`) on `GET /admin/orders`; Task 2 proves it. Only if it does not work, add an `exclude_ids` param to the vendored validators as the spec's fallback.

## Review Focus

- A held order never appears in Ready to Ship and can never be bulk-fulfilled; releasing restores it exactly.
- Each tab's count equals the number of rows its table shows (same filters in both places).
- Hold/release/cancel are rejected for shipped (fully fulfilled) or already-canceled orders and for already-held orders; double submits do nothing.
- Alert computation never throws on orders with missing items, weights, variants or addresses.
- Due badge buckets use the store time zone and treat a missing handling-hours setting as "no badge".

---

### Task 1: Backend hold and release

**Files:**
- Create: `apps/backend/src/workflows/hold-order.ts`, `apps/backend/src/workflows/release-order.ts`, `apps/backend/src/workflows/steps/hold-order-steps.ts`, `apps/backend/src/api/admin/orders/[id]/hold/route.ts`, `apps/backend/src/api/admin/orders/[id]/release/route.ts`, `apps/backend/src/api/admin/orders/middlewares.ts`
- Modify: `apps/backend/src/api/middlewares.ts` (spread the new routes' middlewares)
- Test: `apps/backend/src/workflows/__tests__/hold-order.unit.spec.ts`, `apps/backend/src/api/admin/orders/__tests__/hold-release.unit.spec.ts`

**Interfaces:**
- Produces: `holdOrderWorkflow` (input `{ order_id: string; reason: string; user_id?: string }` → `{ order_id; tag_id }`), `releaseOrderWorkflow` (input `{ order_id: string }` → `{ order_id }`), constant `HOLD_TAG_VALUE = "On hold"` exported from the steps file.
- Routes: `POST /admin/orders/:id/hold` body `z.strictObject({ reason: z.string().trim().min(1).max(255) })`; `POST /admin/orders/:id/release` empty body. Responses `200 { order_id, on_hold: boolean }`; errors `400` with `{ message }` when the order is fully fulfilled/shipped, canceled, already held (hold) or not held (release); `404` for an unknown order.
- Behaviour: step 1 validates state (reads `status`, `fulfillment_status`, `tags.value`, `metadata`); step 2 finds or creates the tag (`createOrderTagsWorkflow` when missing); step 3 `bulkTagOrdersWorkflow({ order_ids, add:[tagId] })` and `updateOrderWorkflow` writing `metadata.hold = { reason, held_at (ISO), held_by (user_id|null) }` (merge, keep other metadata keys). Release removes the tag and sets `metadata.hold` to `null`/removes it. Compensation restores the previous tags/metadata on failure.

- [ ] **Step 1: Failing tests** (jest, mocked core-flows in the style of `create-marketplace-sales-channel.unit.spec.ts`): `hold creates the On hold tag only when missing`; `hold attaches the tag and writes metadata.hold with reason, held_at and held_by`; `hold keeps unrelated metadata keys`; `hold rejects a canceled order`; `hold rejects a fully fulfilled order`; `hold rejects an already held order`; `release removes the tag and clears metadata.hold`; `release rejects an order that is not held`; route tests: `empty or 256-char reason is 400`, `unknown key is 400`, `unknown order is 404`, `success returns on_hold true/false`, `double hold second call is 400`.
- [ ] **Step 2: Run** `cd apps/backend && yarn test:unit -- hold-order hold-release` — FAIL.
- [ ] **Step 3: Implement** the steps, the two workflows (use `createWorkflow` with `function`, `transform`, `.config({name})` on repeated steps; compensation in the steps) and the routes + middlewares (`validateAndTransformBody`, admin auth by default).
- [ ] **Step 4: Run** the new tests, then `npx tsc --noEmit`, `npx medusa lint`, `yarn test:unit` — PASS.
- [ ] **Step 5: Commit** `feat(backend): hold and release orders`.

---

### Task 2: Dashboard data layer — views, counts, holds

**Files:**
- Create: `packages/admin/dashboard/src/routes/orders/order-list/order-views.ts`, `packages/admin/dashboard/src/hooks/api/order-holds.tsx`, `packages/admin/dashboard/src/hooks/api/order-view-counts.tsx`
- Test: `…/order-list/__tests__/order-views.spec.ts`, `packages/admin/dashboard/src/hooks/api/__tests__/order-view-counts.spec.tsx`, `packages/admin/dashboard/src/hooks/api/__tests__/order-holds.spec.tsx`, a serialization spec for the `$nin` query

**Interfaces:**
- Produces `order-views.ts`: `type OrderListView = "all" | "ready-to-ship" | "shipped" | "awaiting-payment" | "on-hold" | "cancelled"` (extends the existing type in `order-list-tabs.tsx`; that file re-exports it), `ORDER_VIEW_ORDER` (tab order), and `getViewQuery(view, { heldIds: string[]; holdTagId: string | null }) : Record<string, unknown>` returning the list-API params for each tab: all → `{}`; ready-to-ship → `{ fulfillment_status: ["not_fulfilled","partially_fulfilled"], payment_status: ["captured","partially_captured"], status: { $nin: ["canceled"] }, ...(heldIds.length ? { id: { $nin: heldIds } } : {}) }`; shipped → the existing Shipped table's params (read them from `shipped-table.tsx` and reuse the same constant — extract it into this file and import it from `shipped-table.tsx`); awaiting-payment → `{ payment_status: ["not_paid","awaiting"], status: { $nin: ["canceled"] }, ...held exclusion }`; on-hold → `{ tag_id: holdTagId, status: { $nin: ["canceled"] } }` (empty result when `holdTagId` is null); cancelled → `{ status: "canceled" }`.
- Produces hooks: `useHoldTag(): { tagId: string | null; isLoading }` (finds the tag whose value is `On hold` via `useOrderTags`), `useHeldOrderIds(): { ids: string[]; isLoading }` (orders with that tag, `fields=id`, not canceled, limit 500), `useHoldOrder()` / `useReleaseOrder()` (mutations calling `POST /admin/orders/:id/hold|release`, invalidating the orders list, the counts and the tag/held queries), `useOrderViewCounts(): Record<OrderListView, number | null>` (one `limit=1, fields=id` request per tab using `getViewQuery`, `staleTime` 30 s, a failed tab yields `null`).

- [ ] **Step 1: Failing tests:** `getViewQuery returns the documented params per view`; `ready-to-ship and awaiting-payment omit id.$nin when nothing is held`; `on-hold with no tag id returns an impossible filter (no rows)`; `useOrderViewCounts returns a count per tab and null for a failed tab`; `hold/release mutations invalidate the lists and counts`; `the list query serializer emits id[$nin] for an id operator filter and the vendored AdminGetOrdersParams accepts it` (parse `{ id: { $nin: ["a","b"] } }` with `AdminGetOrdersParams` from `packages/medusa/src/api/admin/orders/validators.ts`; if this fails, implement the spec's fallback `exclude_ids` in the validators and the transform, with its own test, and make `getViewQuery` use it).
- [ ] **Step 2: Run** `cd packages/admin/dashboard && yarn test src/routes/orders src/hooks/api` — new tests FAIL.
- [ ] **Step 3: Implement** the files above following the neighbouring `hooks/api/orders.tsx` / `order-tags.tsx` patterns (query-key factory, `sdk.client.fetch`).
- [ ] **Step 4: Run** the tests, `yarn typecheck`, `yarn lint` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): order view queries, counts and hold hooks`.

---

### Task 3: Six tabs with counts and the three new tables

**Files:**
- Modify: `…/order-list-table/order-list-tabs.tsx`, `…/order-list-table/order-list-table.tsx` (view switch), `…/components/ready-to-ship-table.tsx` (use `getViewQuery` + held exclusion), `en.json`
- Create: `…/components/awaiting-payment-table.tsx`, `…/components/on-hold-table.tsx`, `…/components/cancelled-table.tsx`
- Test: `…/order-list-tabs.spec.tsx`, `…/components/on-hold-table.spec.tsx`, `…/components/awaiting-payment-table.spec.tsx`, extend `ready-to-ship-table.spec.tsx`

**Interfaces:**
- Consumes: Task 2 (`OrderListView`, `getViewQuery`, `useOrderViewCounts`, `useHeldOrderIds`, `useHoldTag`).
- Produces: `OrderListTabs` renders six `Tabs.Trigger`s from `ORDER_VIEW_ORDER`, each showing a count badge (`–` when null, spinner-free while loading); `getOrderListView` accepts the three new values. Awaiting Payment, On Hold and Cancelled tables are small `useDataTable` tables (same page size 20, `?view=` navigation, order number link, customer, date, total, payment/fulfillment badges; On Hold adds a Reason column from `metadata.hold.reason` and a Release action wired in Task 6). Ready to Ship's `useOrders` call takes its params from `getViewQuery("ready-to-ship", …)`.

- [ ] **Step 1: Failing tests:** `renders six tabs with counts and a dash for a failed count`; `links keep other query params and drop view for All`; `unknown ?view= falls back to All`; `Ready to Ship query excludes held ids`; `On Hold tab lists only tagged orders and shows the reason`; `Awaiting Payment excludes canceled`; `a held order disappears from Ready to Ship and its count drops after hold` (mutation invalidation).
- [ ] **Step 2: Run** `yarn test src/routes/orders/order-list` — FAIL.
- [ ] **Step 3: Implement** the tabs, the switch in `order-list-table.tsx`, and the three tables, reusing the existing column hooks where they fit.
- [ ] **Step 4: Run** tests, `yarn typecheck`, `yarn lint` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): six order tabs with counts`.

---

### Task 4: Alert, due and channel helpers (pure functions)

**Files:**
- Create: `…/components/order-alerts.ts`, `…/components/due-status.ts`, `…/components/channel-color.ts`
- Test: `…/components/order-alerts.spec.ts`, `…/components/due-status.spec.ts`, `…/components/channel-color.spec.ts`

**Interfaces:**
- Produces `order-alerts.ts`: `type OrderAlert = { code: "missing_weight" | "no_rates" | "payment_pending" | "po_box_non_usps" | "high_value"; messageKey: string; params?: Record<string, unknown> }` and `computeOrderAlerts(input: { order: ReadyToShipOrder; quote: { status: "idle" | "loading" | "error" | "ok"; rates?: unknown[]; selectedCarrier?: string | null }; highValueThreshold: number }): OrderAlert[]`. Rules: any line item whose variant/product weight is missing or 0 → `missing_weight`; quote `error`, or `ok` with an empty `rates` → `no_rates`; `payment_status` not captured/partially_captured/refunded → `payment_pending`; shipping address `address_1`/`address_2` matching `/\b(p\.?\s?o\.?\s?box|post office box)\b/i` while `selectedCarrier` is set and not `USPS` → `po_box_non_usps`; `total` (major units) above the threshold → `high_value`. Never throws; missing fields yield no alert.
- Produces `due-status.ts`: `getDueStatus(deadline: Date | null, now: Date, timeZone: string): { kind: "overdue" | "today" | "tomorrow" | "days"; days?: number } | null` (null when no deadline; calendar-day comparison in `timeZone`; overdue when `now` is after the deadline).
- Produces `channel-color.ts`: `getChannelColor(name: string): "blue" | "green" | "orange" | "purple" | "red" | "grey"` — a stable hash of the lowercased name onto the six colours.

- [ ] **Step 1: Failing tests:** each alert rule on and off; `missing weight when an item has no variant`; `po box with USPS is not an alert, with UPS/FedEx is`; `po box detection is case-insensitive and ignores "Pomona Boulevard"`; `high value boundary: equal is not an alert`; `malformed order (no items, no address, no total) returns []`; `getDueStatus: past deadline overdue, same day today, next day tomorrow, 3 days days:3, null deadline null, midnight rollover in a non-UTC zone`; `getChannelColor is stable and case-insensitive`.
- [ ] **Step 2: Run** `yarn test src/routes/orders/order-list/components/order-alerts src/routes/orders/order-list/components/due-status src/routes/orders/order-list/components/channel-color` — FAIL.
- [ ] **Step 3: Implement** the three modules (no React in them).
- [ ] **Step 4: Run** tests, `yarn typecheck`, `yarn lint` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): order alert, due status and channel colour helpers`.

---

### Task 5: Ready to Ship columns and overdue banner

**Files:**
- Create: `…/components/alerts-cell.tsx`, `channel-chip.tsx`, `due-badge.tsx`, `delivery-cell.tsx`, `email-toggle.tsx`, `row-tags-cell.tsx`, `overdue-banner.tsx` (each with a spec)
- Modify: `…/components/ready-to-ship-table.tsx` (columns, row highlight, banner, per-row `sendEmail` state, `no_notification` in the bulk payload), `en.json`; if the batch route/step does not already forward `no_notification` per order, extend `packages/medusa/src/api/admin/orders/fulfillments/batch/route.ts`, its validator and `packages/core/core-flows/src/order/steps/bulk-fulfill-orders.ts` with an optional `no_notification` per order, with tests
- Test: the new specs plus extend `ready-to-ship-table.spec.tsx`

**Interfaces:**
- Consumes: Task 4 helpers; existing `rowRates`, `getHandlingHours`, `computeShipDeadline`, store metadata (`store.metadata.high_value_threshold`, default 500).
- Behaviour: new columns in this order after Customer: Alerts (icon with tooltip listing `messageKey`s; rows with alerts get a soft highlight class), Channel (`channel-chip` with the sales channel name and `getChannelColor`), Item…Ship Time as today, Due (`due-badge` from `getDueStatus` on the existing deadline; none when handling hours are not configured; the existing Ship Time column stays), Delivery (first shipping method name, read only), Email (switch, default on; off sends `no_notification: true` for that order in the bulk and single fulfill calls), Tags (chips of the order's tags + "+" opening the existing bulk-tag modal for that single order), then the existing Fulfill column. `overdue-banner` above the table shows "N overdue orders" computed from the loaded page and, on click, toggles an "overdue only" filter on the loaded rows.

- [ ] **Step 1: Failing tests:** `alerts cell lists every reason on hover and renders nothing when none`; `row with alerts is highlighted`; `channel chip shows the channel name and a stable colour`; `due badge shows Overdue / Due today / Due tomorrow / Due in N days and nothing without handling hours`; `delivery cell shows the shipping method name or a dash`; `email toggle defaults on and turning it off sends no_notification true for that order only`; `tags cell shows chips and the plus opens the modal for that order`; `overdue banner shows the count and filters to overdue rows on click`; `bulk and single fulfill payloads carry no_notification` (and the backend/core-flows tests if those were extended).
- [ ] **Step 2: Run** `yarn test src/routes/orders/order-list` — FAIL.
- [ ] **Step 3: Implement**; keep `ready-to-ship-table.tsx` from growing further by putting each new cell in its own file and only wiring columns there.
- [ ] **Step 4: Run** tests, `yarn typecheck`, `yarn lint` (and the core-flows/medusa tests only if touched) — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): Ready to Ship alerts, channel, due, delivery, email and tags columns`.

---

### Task 6: Row actions menu, hold prompt and the high-value setting

**Files:**
- Create: `…/components/row-actions-menu.tsx`, `…/components/hold-order-prompt.tsx` (each with a spec)
- Modify: `…/components/ready-to-ship-table.tsx` (menu next to the Fulfill button), `…/components/on-hold-table.tsx` (Release action, hold reason, "On hold" badge), the dashboard order list cells for an "On hold" badge on All, `apps/backend/src/admin/routes/settings/fulfillment/page.tsx` (+ its test) for the high-value threshold, `en.json`

**Interfaces:**
- Consumes: Task 1 routes via Task 2 hooks (`useHoldOrder`, `useReleaseOrder`); existing cancel-order hook (`useCancelOrder` in `hooks/api/orders.tsx`) and its confirm prompt.
- Behaviour: the menu offers Put on hold (opens `hold-order-prompt`: required reason textarea, max 255, Confirm disabled while empty or pending), Cancel order (existing confirmation; hidden/disabled with a tooltip when the order has any fulfillment, "void the label first" until Slice B), and, on the On Hold tab, Release. Errors show the server message in a toast; the menu closes on success and the counts refresh. The Settings > Fulfillment page gains a "High-value order alert threshold" numeric field saved to `store.metadata.high_value_threshold` with the same save pattern as the existing handling-hours fields (blank = default 500).

- [ ] **Step 1: Failing tests:** `hold prompt requires a reason and trims it`; `hold calls the hold hook with the reason and refreshes counts`; `server error shows the message and leaves the row`; `release calls the release hook`; `cancel is disabled with a tooltip for an order with a fulfillment`; `menu is not offered for a shipped order's hold`; `settings page saves and reloads the threshold, blank resets to default` (backend admin page jest/vitest style used by the neighbouring settings test).
- [ ] **Step 2: Run** `yarn test src/routes/orders/order-list` in the dashboard and `yarn test:unit -- settings/fulfillment` in the backend — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, dashboard `yarn typecheck && yarn lint`, backend `npx tsc --noEmit && npx medusa lint` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): row actions menu with hold, release and cancel`.

---

### Task 7: Full verification and hand-off

**Files:** none new; fix anything the checks surface in the owning task's files.

- [ ] **Step 1:** `cd packages/admin/dashboard && yarn typecheck && yarn lint && yarn test && yarn build` — PASS (the build refreshes `dist`, which the backend serves; do not start or restart any server).
- [ ] **Step 2:** `cd apps/backend && npx tsc --noEmit && npx medusa lint && yarn test:unit` — PASS. If `packages/medusa` or `packages/core/core-flows` were touched, run their unit tests for the touched files too.
- [ ] **Step 3:** Confirm by reading the diff that no tab query differs between the count hook and its table (single `getViewQuery` source), and that Ready to Ship's data path for non-held orders is unchanged.
- [ ] **Step 4:** Write a short hand-off note (not committed): what to restart (backend, after the dashboard build), and a manual check list for the owner (hold an order and watch it leave Ready to Ship and counts change; release it; try cancel on a fulfilled order; set the high-value threshold and see the alert; turn Email off and fulfill).
- [ ] **Step 5: Commit** only if fixes were needed: `chore: fixes from final verification`.
