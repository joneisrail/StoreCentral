# Unified Fulfillment Queue — Design

## Purpose

Give merchants a single page, inside Medusa's existing Admin dashboard,
that lists every order needing fulfillment — regardless of which sales
channel it came from (storefront, Amazon via Seller Hub, POS, mobile) —
so they don't have to dig through the generic Orders list to find what
needs shipping. Modeled on Amazon Seller Central's "Manage Orders /
Unshipped" queue, scoped down to what this store actually needs for v1.

**Intended outcome:** opening one admin page shows every not-yet-fulfilled
order across all channels, oldest first, with enough information to
triage at a glance and one click into the order to actually fulfill it.

**Explicitly out of scope for v1** (the merchant can revisit later):
- Fulfilling or creating shipments directly from the queue (view + link
  to the order only; Medusa's own order detail page already has the
  fulfillment/EasyPost-label flow).
- Per-channel filtering (a channel badge on each row is enough for v1).
- Ship-by-deadline / SLA "late" flagging.
- Bulk actions (select many orders, fulfill together).

## A real constraint this design works around

Medusa's `fulfillment_status` on an order is **not a real, queryable
database column** — it is computed in application code, per order,
*after* the database query already ran, from that order's fulfillments'
`packed_at`/`shipped_at`/`delivered_at`/`canceled_at` timestamps
(`getLastFulfillmentStatus` in `@medusajs/core-flows`, used by the core
`getOrdersListWorkflow` that backs both the Admin and Store "list orders"
routes).

This was verified three independent ways against the real running
backend, not assumed from the types:
1. `FilterableOrderProps` (the admin list route's typed filter DTO) does
   not list `fulfillment_status` at all.
2. A live `GET /admin/orders?fulfillment_status[]=canceled` request
   against the real backend silently ignored the filter and returned an
   arbitrary order with a *different* status — proving the REST layer
   drops this filter rather than rejecting or honoring it.
3. A direct `query.graph({ entity: "order", filters: { fulfillment_status: ... } })`
   call (bypassing the REST layer entirely) threw
   `Trying to query by not existing property Order.fulfillment_status` —
   proving it isn't a real column at the ORM level either.

Consequence: this queue cannot ask the database for "orders where
fulfillment_status is not_fulfilled or partially_fulfilled" directly.
Instead, a custom backend route fetches a bounded recent window of
orders (including their fulfillment timestamp fields), computes each
one's real status using Medusa's own `getLastFulfillmentStatus` (imported
from `@medusajs/core-flows`, never reimplemented — this keeps the
queue's definition of "unfulfilled" identical to core's, with zero risk
of drifting out of sync if core's own status logic ever changes), filters
to the two "needs fulfillment" statuses, sorts oldest-first, and paginates
the *filtered* result itself.

**Known, accepted scaling limit:** the backend route bounds its initial
fetch to orders created in the last 90 days, capped at the 500 most
recent orders (whichever limit is hit first) — not the entire orders
table. An unfulfilled order older than that window, or beyond the 500th
most recent order, will not appear in the queue. For this store's actual
operating scale, and the realistic assumption that orders needing
fulfillment are almost always recent, this is an acceptable tradeoff —
but it is a real limit, not an oversight, and is called out here so it
can be revisited if order volume or backlog patterns change.

## Architecture

```
Admin browser
   └─ GET apps/backend/src/admin/routes/fulfillment-queue/page.tsx
         (new custom Admin route — Medusa auto-adds it to the sidebar
          nav via `defineRouteConfig`)
         └─ calls GET /admin/fulfillment-queue (new custom API route)
               apps/backend/src/api/admin/fulfillment-queue/route.ts
               └─ runs getOrdersListWorkflow (from @medusajs/core-flows)
                     bounded by created_at >= now-90d, take 500,
                     fields: id, display_id, created_at, email, total,
                     currency_code, sales_channel.name, items.id,
                     fulfillments.packed_at/shipped_at/delivered_at/canceled_at
               └─ computes fulfillment_status per order via
                     getLastFulfillmentStatus (from @medusajs/core-flows)
               └─ filters to not_fulfilled | partially_fulfilled
               └─ sorts by created_at ascending
               └─ paginates the filtered array (offset/limit query params)
               └─ returns { orders, count, offset, limit }
```

No new app, no new auth: this lives entirely inside the existing Medusa
Admin dashboard (`apps/backend`), reusing its session/auth and its
existing order detail page for the actual fulfillment action.

## API contract

`GET /admin/fulfillment-queue?offset=0&limit=20`

Response:
```json
{
  "orders": [
    {
      "id": "order_...",
      "display_id": 424,
      "created_at": "2026-10-19T20:28:15.733Z",
      "email": "demo-customer@example.com",
      "total": 24.44,
      "currency_code": "usd",
      "fulfillment_status": "not_fulfilled",
      "sales_channel": { "id": "sc_...", "name": "Amazon" },
      "item_count": 1
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 20
}
```

`count` is the count of the *filtered* set (orders actually needing
fulfillment within the 90-day/500-order window), not the total orders
table size — pagination (`offset`/`limit`) operates against that
filtered count.

## UI

New sidebar page "Fulfillment Queue" (via `defineRouteConfig`'s `label`),
table with columns: Order #, Channel (badge), Date, Customer, Items,
Status (badge: "Not fulfilled" / "Partially fulfilled"), Total. Order #
links to Medusa's existing `/orders/:id` admin page.

- **Empty state:** "No orders need fulfillment right now." when the
  filtered list is empty.
- **Loading state:** a skeleton/spinner while the request is in flight.
- **Error state:** if the request fails (e.g. the backend route throws),
  show an inline error message with a retry button — never silently
  swallowed or shown as an empty queue.

Pagination: standard prev/next controls, same page-size convention as
Medusa's own Orders list.

## Testing

Integration tests in `apps/backend/integration-tests/http/` for the new
`/admin/fulfillment-queue` route, against a real running test backend
(this repo's established convention — no mocking of the database or
Medusa's own workflows):

- Seeds orders in each of the 8 `fulfillment_status` values (achieved by
  creating orders and then fulfilling/shipping/delivering/canceling them
  through the real admin fulfillment flow, not by writing status directly)
  across at least two sales channels.
- Asserts the response includes only `not_fulfilled` and
  `partially_fulfilled` orders, each with the correct channel name.
- Asserts ordering is oldest-first.
- Asserts pagination (`offset`/`limit`) operates on the filtered set,
  not the raw order count.
- Asserts an order created outside the 90-day window (test seeds one
  with a backdated `created_at` beyond that boundary, or exercises the
  windowing logic via a lower injectable boundary for test speed) is
  correctly excluded — proving the known scaling limit behaves as
  designed, not as a silent bug.

No frontend component tests for v1 — this codebase has no existing
precedent for testing custom Admin UI pages, and the logic actually
worth protecting (the status computation, filtering, and windowing)
lives entirely in the backend route.

## Review Focus

- An order whose only fulfillment item was fully returned and refunded
  still resolves to a real `fulfillment_status` via the same
  `getLastFulfillmentStatus` core uses — no special-casing needed, since
  the queue defers to core's own definition rather than inventing one.
- A canceled order must never appear in the queue even if it was never
  fulfilled (`canceled` is excluded by the explicit allow-list of two
  statuses, not by excluding `canceled` specifically — so a future new
  status value added to core defaults to *not* appearing, the safer
  direction).
- Draft orders: `getOrdersListWorkflow`'s default fields/variables do not
  exclude draft orders, so the custom route explicitly filters
  `is_draft_order: false` (via the order's own field) to avoid listing
  unconverted draft orders as needing fulfillment.
- A sales channel that was deleted after the order was placed: the
  `sales_channel` relation can resolve to `null` — the UI must show a
  "—" / "Unknown channel" badge rather than crashing on a missing
  `.name`.
- Large `item_count` orders: `getOrdersListWorkflow` unconditionally
  fetches full `items.*` for every order regardless of what fields the
  caller requests (confirmed in its source — it hardcodes `items.*` into
  the query itself, since `getLastFulfillmentStatus` needs each item's
  quantity/fulfilled-quantity to compute status). The route cannot avoid
  this cost and doesn't try to; `item_count` is simply `items.length` on
  data already fetched for the status computation, not an extra request.
