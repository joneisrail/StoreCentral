# Unified Fulfillment Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom Medusa Admin page that lists every order needing
fulfillment across all sales channels, oldest first, linking into
Medusa's existing per-order fulfillment flow.

**Architecture:** A new custom admin API route computes each recent
order's real fulfillment status (reusing core's own
`getLastFulfillmentStatus`/`getOrdersListWorkflow` rather than
reimplementing status logic), filters to the two "needs fulfillment"
statuses, sorts oldest-first, and paginates the filtered set. A new
custom Admin UI page calls that route and renders a table.

**Tech Stack:** `@medusajs/core-flows` (`getOrdersListWorkflow`,
`getLastFulfillmentStatus`), Medusa's custom API/Admin route conventions
(`apps/backend/src/api/admin/...`, `apps/backend/src/admin/routes/...`),
`@medusajs/js-sdk`, `@medusajs/ui` (`Table`, `Badge`, `Container`,
`Heading`), `@tanstack/react-query`, Jest + `@medusajs/test-utils`
(`medusaIntegrationTestRunner`).

**Spec:** `docs/superpowers/specs/2026-10-20-fulfillment-queue-design.md`

## Global Constraints

- `fulfillment_status` is NOT a real queryable column (confirmed: throws
  `Trying to query by not existing property Order.fulfillment_status`
  via `query.graph`, and is silently dropped by the admin REST filter).
  Never attempt to filter/sort it at the database level. Always compute
  it via `getLastFulfillmentStatus` (from `@medusajs/core-flows`) on
  orders already fetched with their `fulfillments.*`/`items.*` data —
  never reimplement this computation.
- Bounded window for the initial fetch: `created_at >= now - 90 days`,
  capped at the 500 most recent orders (`take: 500`) — whichever limit
  is hit first. This is a deliberate, accepted scaling limit, not a bug.
- `is_draft_order` IS a real, indexed, filterable column
  (`IDX_order_is_draft_order` in `packages/modules/order/src/models/order.ts`)
  — draft orders must be excluded via a real filter
  (`is_draft_order: false`) in the initial fetch, not computed/filtered
  client-side.
- No mocking of the database or Medusa's own workflows in tests — this
  project's established convention (see
  `apps/backend/integration-tests/http/easypost-webhook.spec.ts`) is
  real calls against a real test backend via `medusaIntegrationTestRunner`.
- Tests must not depend on EasyPost, any external network call, or any
  shipping method/option at all — order fixtures use a product variant
  with `manage_inventory: false` (sidesteps `createOrderFulfillmentWorkflow`'s
  documented requirement that managed-inventory items need a reservation,
  which `createOrderWorkflow` does not create) and fulfillments are
  created with an explicit `location_id`, never a `shipping_option_id`.
- v1 scope is view + link only: no inline "create fulfillment" action
  from the queue, no per-channel filter dropdown, no SLA/late flagging,
  no bulk actions. Do not add any of these.
- Code style (matches this file's existing siblings, e.g.
  `apps/backend/src/api/webhooks/easypost/route.ts`): no semicolons,
  double quotes, 2-space indentation, ES5 trailing commas, always-parens
  arrow functions.

## Review Focus

(Mirrors the spec's own Review Focus section — each line maps to where
this plan covers it.)

- An order with a fully returned/refunded item still resolves a real
  `fulfillment_status` — covered by explanation, not a dedicated test:
  `getLastFulfillmentStatus` only reads `fulfillments.*` timestamps and
  `items[].quantity` vs `items[].detail.fulfilled_quantity`, which a
  return does not change. `buildQueuePage` calls that function directly
  and adds no special-casing of its own, so there is no distinct branch
  in *this* code to test — testing it would just be re-testing core's
  own already-trusted function.
- A canceled order must never appear, even though it was never
  fulfilled — covered by Task 1's allow-list filter (only
  `not_fulfilled`/`partially_fulfilled` pass; everything else, including
  any future new status value, is excluded by default) and its unit
  test "excludes a canceled order".
- A draft order must never appear in the queue — covered by Task 1's
  `is_draft_order: false` filter, with the integration test "excludes a
  draft order even if unfulfilled".
- An order whose sales channel was deleted after the order was placed
  resolves `sales_channel` to `null` — covered by Task 1's response
  shaping (never crashes) and Task 2's UI (`"—"` fallback), with the
  unit test "resolves sales_channel to null without throwing".
- An order just outside the 90-day/500-order window must not appear —
  covered by Task 1's integration test "excludes an order older than
  the 90-day window".
- Pagination (`offset`/`limit`) must operate on the *filtered* count, not
  the raw fetched-window size — covered by Task 1's unit test "paginates
  the filtered set, not the raw input" and integration test "paginates
  the filtered count, not the fetched window size".

---

### Task 1: `/admin/fulfillment-queue` route — status computation, filtering, windowing, pagination

**Files:**
- Create: `apps/backend/src/api/admin/fulfillment-queue/route.ts`
- Create: `apps/backend/src/api/admin/fulfillment-queue/build-queue-page.ts`
- Test: `apps/backend/src/api/admin/fulfillment-queue/__tests__/build-queue-page.unit.spec.ts`
- Test: `apps/backend/integration-tests/http/fulfillment-queue.spec.ts`

**Interfaces:**
- Consumes: `getOrdersListWorkflow`, `getLastFulfillmentStatus` (both
  from `@medusajs/core-flows`); `OrderDTO`/`OrderDetailDTO` (from
  `@medusajs/framework/types`).
- Produces (consumed by Task 2):
  - `GET /admin/fulfillment-queue?offset=<number>&limit=<number>`
    response shape:
    ```ts
    type FulfillmentQueueResponse = {
      orders: {
        id: string
        display_id: number
        created_at: string
        email: string | null
        total: number
        currency_code: string
        fulfillment_status: "not_fulfilled" | "partially_fulfilled"
        sales_channel: { id: string; name: string } | null
        item_count: number
      }[]
      count: number
      offset: number
      limit: number
    }
    ```
  - `buildQueuePage(orders: OrderDetailDTO[], pagination: { offset: number; limit: number }): { orders: FulfillmentQueueResponse["orders"]; count: number }`
    — the pure function `build-queue-page.ts` exports. Computes each
    order's status via `getLastFulfillmentStatus`, filters to
    `not_fulfilled`/`partially_fulfilled`, sorts by `created_at`
    ascending, slices `[offset, offset + limit)`, and shapes each
    surviving order into the response row (including the `item_count`
    and null-safe `sales_channel`).

- [ ] **Step 1: Write failing unit tests for `buildQueuePage`**

In `apps/backend/src/api/admin/fulfillment-queue/__tests__/build-queue-page.unit.spec.ts`, construct minimal `OrderDetailDTO`-shaped fixtures by hand (only the fields `getLastFulfillmentStatus` and `buildQueuePage` actually touch: `id`, `display_id`, `created_at`, `email`, `total`, `currency_code`, `sales_channel`, `items` with `raw_quantity`/`detail.raw_fulfilled_quantity`, `fulfillments` with `packed_at`/`shipped_at`/`delivered_at`/`canceled_at`). Test cases:

```ts
test("excludes a fulfilled order", () => {
  const result = buildQueuePage([fulfilledOrderFixture], { offset: 0, limit: 20 })
  expect(result.orders).toHaveLength(0)
  expect(result.count).toBe(0)
})

test("excludes a canceled order", () => {
  const result = buildQueuePage([canceledOrderFixture], { offset: 0, limit: 20 })
  expect(result.orders).toHaveLength(0)
})

test("includes a not_fulfilled order and a partially_fulfilled order, sorted oldest first", () => {
  const result = buildQueuePage(
    [newerPartiallyFulfilledFixture, olderNotFulfilledFixture],
    { offset: 0, limit: 20 }
  )
  expect(result.orders.map((o) => o.id)).toEqual([
    olderNotFulfilledFixture.id,
    newerPartiallyFulfilledFixture.id,
  ])
})

test("resolves sales_channel to null without throwing when the order has none", () => {
  const result = buildQueuePage([orderWithNullSalesChannelFixture], { offset: 0, limit: 20 })
  expect(result.orders[0].sales_channel).toBeNull()
})

test("counts item_count from items.length", () => {
  const result = buildQueuePage([twoItemOrderFixture], { offset: 0, limit: 20 })
  expect(result.orders[0].item_count).toBe(2)
})

test("paginates the filtered set, not the raw input", () => {
  const fiveUnfulfilled = [/* 5 not_fulfilled fixtures, distinct created_at */]
  const result = buildQueuePage(fiveUnfulfilled, { offset: 2, limit: 2 })
  expect(result.orders).toHaveLength(2)
  expect(result.count).toBe(5)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && yarn test:unit -- build-queue-page -v`
Expected: FAIL with "buildQueuePage is not a function" / module not found.

- [ ] **Step 3: Implement `buildQueuePage` in `build-queue-page.ts`**

Signature and behavior exactly as specified in the Interfaces block
above. Use `getLastFulfillmentStatus(order)` per order to compute
status; keep only orders whose computed status is `"not_fulfilled"` or
`"partially_fulfilled"`; sort the survivors by `created_at` ascending;
compute `count` from the survivors' length (not the input length);
slice `[offset, offset + limit)` for the returned `orders`; shape each
into the response row (`sales_channel: order.sales_channel ? { id, name } : null`,
`item_count: order.items?.length ?? 0`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && yarn test:unit -- build-queue-page -v`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Write failing integration tests for the route**

In `apps/backend/integration-tests/http/fulfillment-queue.spec.ts`, using
`medusaIntegrationTestRunner` (same pattern as
`easypost-webhook.spec.ts`). Test setup creates, once per test file via
`beforeAll`: a product with one variant with `manage_inventory: false`;
two sales channels (e.g. "Storefront", "Amazon") via
`createSalesChannelsWorkflow`; a region via `createRegionsWorkflow`
(needed by `createOrderWorkflow`). A shared helper
`createOrderInStatus(status, { salesChannelId, createdAt })` creates an
order via `createOrderWorkflow` (no `shipping_address`, no shipping
method — not needed for fulfillment-status computation) with that
variant and sales channel, then, depending on `status`:
  - `"not_fulfilled"`: creates nothing further.
  - `"partially_fulfilled"`: not reachable with a single-item order
    (partial requires more than one item or quantity > 1 fulfilled
    partially) — use `quantity: 2` on the order item and fulfill only
    `quantity: 1` via `POST /admin/orders/:id/fulfillments` with an
    explicit `location_id` (create one real stock location in
    `beforeAll` via `createStockLocationsWorkflow`) and no
    `shipping_option_id`.
  - `"fulfilled"`: fulfill the full quantity the same way.
  - `"shipped"`: fulfill fully, then
    `POST /admin/orders/:id/fulfillments/:fulfillment_id/shipments`.
  - `"delivered"`: same, then
    `POST /admin/orders/:id/fulfillments/:fulfillment_id/mark-as-delivered`.
  - `"canceled"`: fulfill fully, then
    `POST /admin/orders/:id/fulfillments/:fulfillment_id/cancel`.

```ts
it("returns only not_fulfilled and partially_fulfilled orders, oldest first, with channel names", async () => {
  // seed: not_fulfilled (channel A, oldest), partially_fulfilled (channel B),
  // fulfilled, shipped, delivered, canceled (all excluded)
  const res = await api.get("/admin/fulfillment-queue", adminHeaders)
  expect(res.data.orders.map((o) => o.fulfillment_status)).toEqual([
    "not_fulfilled",
    "partially_fulfilled",
  ])
  expect(res.data.orders[0].sales_channel.name).toBe("Storefront")
  expect(res.data.orders[1].sales_channel.name).toBe("Amazon")
})

it("excludes a draft order even if unfulfilled", async () => {
  // seed a draft order (createOrderWorkflow input: is_draft_order via
  // the draft-order module's own creation path, or set status such that
  // is_draft_order is true) alongside one real not_fulfilled order
  const res = await api.get("/admin/fulfillment-queue", adminHeaders)
  expect(res.data.orders.find((o) => o.id === draftOrder.id)).toBeUndefined()
})

it("excludes an order older than the 90-day window", async () => {
  // seed one order with a backdated created_at beyond 90 days (directly
  // update the row's created_at after creation, since the workflow
  // itself always stamps "now") alongside one recent not_fulfilled order
  const res = await api.get("/admin/fulfillment-queue", adminHeaders)
  expect(res.data.orders.find((o) => o.id === oldOrder.id)).toBeUndefined()
})

it("paginates the filtered count, not the fetched window size", async () => {
  // seed 3 not_fulfilled orders
  const res = await api.get("/admin/fulfillment-queue?offset=0&limit=2", adminHeaders)
  expect(res.data.orders).toHaveLength(2)
  expect(res.data.count).toBe(3)
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apps/backend && yarn test:integration:http -- fulfillment-queue -v`
Expected: FAIL with 404 (route doesn't exist yet).

- [ ] **Step 7: Implement the route in `route.ts`**

```ts
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // ...
}
```

Parse `offset`/`limit` from `req.query` (default `offset: 0`,
`limit: 20`). Resolve `getOrdersListWorkflow` and run it with:
`fields: ["display_id", "created_at", "email", "total", "currency_code", "sales_channel.id", "sales_channel.name"]`
(the workflow always additionally fetches `items.*` and
`fulfillments.{packed_at,shipped_at,delivered_at,canceled_at}` itself —
do not request those explicitly, they're already guaranteed);
`variables: { is_draft_order: false, created_at: { $gte: <90-days-ago ISO string> }, order: { created_at: "ASC" }, take: 500 }`.
Pass the workflow's result array into `buildQueuePage` with the
parsed `{ offset, limit }`, and respond `res.json(result)`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/backend && yarn test:integration:http -- fulfillment-queue -v`
Expected: PASS, all 4 cases.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/api/admin/fulfillment-queue apps/backend/integration-tests/http/fulfillment-queue.spec.ts
git commit -m "feat(backend): add the /admin/fulfillment-queue route"
```

---

### Task 2: Admin UI page

**Files:**
- Create: `apps/backend/src/admin/lib/sdk.ts`
- Create: `apps/backend/src/admin/routes/fulfillment-queue/page.tsx`
- Modify: `apps/backend/src/admin/vite-env.d.ts`

**Interfaces:**
- Consumes: Task 1's `GET /admin/fulfillment-queue` response shape
  (`FulfillmentQueueResponse`, reproduced as a local type in `page.tsx`
  since this extension has no shared types package to import it from).
- Produces: nothing further downstream — this is the plan's final task.

- [ ] **Step 1: Declare the `__BACKEND_URL__` global in `vite-env.d.ts`**

Add `declare const __BACKEND_URL__: string | undefined` (matches
`packages/admin/dashboard/src/vite-env.d.ts`'s own declaration for the
same bundler-injected constant, which this admin extension's build
shares).

- [ ] **Step 2: Create the SDK client helper in `lib/sdk.ts`**

```ts
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: __BACKEND_URL__ ?? "/",
  auth: { type: "session" },
})
```

- [ ] **Step 3: Create the page in `routes/fulfillment-queue/page.tsx`**

Default-exports a `FulfillmentQueuePage` component; named-exports
`config = defineRouteConfig({ label: "Fulfillment Queue" })` (from
`@medusajs/admin-sdk`). Fetches via `useQuery` (from
`@tanstack/react-query`) calling
`sdk.client.fetch<FulfillmentQueueResponse>("/admin/fulfillment-queue", { query: { offset, limit } })`,
with `offset`/`limit` as local component state (`useState`, default
`offset: 0`, `limit: 20`) driving prev/next pagination controls.

Render, using `@medusajs/ui`'s `Container`/`Heading`/`Table`/`Badge`:
- A `Container` with a `Heading` reading "Fulfillment Queue".
- Loading: a simple loading indicator while `isLoading`.
- Error: an inline error message with a retry button
  (`refetch` from `useQuery`) when `isError`.
- Empty: "No orders need fulfillment right now." when
  `data.orders.length === 0`.
- Otherwise, a `Table` with columns Order # (a plain link to
  `/app/orders/${order.id}`, Medusa Admin's own order detail route),
  Channel (`order.sales_channel?.name ?? "—"` in a `Badge`), Date
  (`order.created_at`, formatted with `toLocaleDateString`), Customer
  (`order.email ?? "—"`), Items (`order.item_count`), Status
  (`order.fulfillment_status`, in a `Badge`, replacing underscores with
  spaces for display), Total (`order.total` with `order.currency_code`).
  Prev/next buttons beneath the table, disabled appropriately at the
  start/end of the filtered set (`offset === 0` / `offset + limit >= data.count`).

- [ ] **Step 4: Manually verify against the real running backend**

Run: `cd apps/backend && yarn dev`, then open
`http://localhost:9000/app/fulfillment-queue` (or navigate via the new
"Fulfillment Queue" sidebar entry) in a browser, logged in as an admin.

Expected: the page loads, shows the real unfulfilled orders from the
dev database (if any exist, per Task 1's route; otherwise the empty
state), each Order # link opens that order's real admin detail page,
and pagination controls work if there are enough orders to page through.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin
git commit -m "feat(backend): add the Fulfillment Queue admin page"
```
