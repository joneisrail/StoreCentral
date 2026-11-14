# Orders page — Slice B: void label, mark shipped, tracking back to channels

Implements FR-25, FR-26, FR-27 (and BR-02/BR-03 follow-through) of
`SRS-order-management-page.md`. Builds on Slice A
(`2026-11-14-orders-slice-a-design.md`, merged) and the EasyPost fulfillment
provider (`2026-10-16-fulfillment-easypost-design.md`). Slice C (search/filters,
history log, roles) stays separate.

## Purpose

Staff can undo a label bought by mistake, ship an order with their own carrier
and tracking number, and the sales channel (Shopify, WordPress/WooCommerce,
Amazon) is told the tracking number automatically.

**Intended outcome:** open an order that has a bought label and press **Void
label**: the carrier refund is requested, the order returns to Ready to Ship and
can be cancelled or re-labelled. Press **Mark shipped** on a Ready to Ship order,
enter carrier and tracking, and the order moves to Shipped. Within minutes the
tracking appears on the order in the sales channel it came from.

**Explicitly out of scope:**
- Printing/reprinting labels, packing slips, split/merge, returns.
- Delivered status from carrier events (already handled by the EasyPost webhook).
- A sync-status screen or retry UI (postponed by the owner); failures are logged
  and visible in seller-hub's `sync_job` table.
- Live Amazon tracking confirmation: the Amazon client method is built and
  unit-tested but stays OFF until the "Amazon going live" piece.
- Pushing tracking for orders created before this release.

## Decisions (recommended options taken)

- **Void = cancel the fulfillment.** Reuses Medusa's cancel-fulfillment flow,
  which already calls the EasyPost provider's `cancelFulfillment` (refund
  request). A new backend route wraps it with checks and a clear message.
- **Mark shipped** creates a fulfillment for the order's open items (no label,
  carrier/tracking typed by the user) and immediately a shipment, using Medusa's
  own fulfillment and shipment workflows.
- **Tracking push** is event-driven: the existing backend subscriber forwards
  `shipment.created` to seller-hub, which enqueues one push job per order on the
  connection's own queue (the connection comes from the order's
  `<marketplace>_account_id` metadata written since the multi-connection
  release). Orders without that metadata (manual orders, web store) are skipped.
- Idempotent per fulfillment: `sync_job` (account, `tracking`, fulfillment id).
- Retries with the existing BullMQ back-off; a permanent channel rejection is
  recorded as failed, never retried forever.

## Behaviour

### Void label
- Row menu (Shipped tab for fulfilled-not-yet-shipped orders, and the order
  detail page) shows **Void label** when the order has a non-canceled fulfillment
  that has a label (`data.easypost_shipment_id`) and no `shipped_at` carrier
  movement yet (`pre_transit`/created only).
- `POST /admin/orders/:id/void-label` (workflow): validates the state, cancels
  every non-canceled, unshipped label fulfillment, returns
  `{ order_id, voided: [{ fulfillment_id, refund_status }] }`.
  `refund_status` is EasyPost's (`submitted`/`rejected`/...). A rejected or
  failed refund returns 400 with the carrier message and leaves the fulfillment
  as it was.
- After void the order is `not_fulfilled` again: it reappears in Ready to Ship,
  and **Cancel order** becomes available (Slice A's cancel guard changes from
  "has any fulfillment" to "has a non-canceled fulfillment").
- The label is never re-bought automatically; the owner buys a new one.

### Mark shipped (own carrier)
- Row menu on Ready to Ship rows (and order detail) → **Mark shipped** modal:
  carrier (free text with suggestions: UPS, FedEx, USPS, DHL, Other), tracking
  number (required), tracking URL (optional; auto-filled for known carriers),
  ship date (default today), "Email the customer" toggle (default on).
- `POST /admin/orders/:id/mark-shipped` (workflow): creates a fulfillment for
  all unfulfilled items at the order's stock location, then a shipment with
  `labels: [{ tracking_number, tracking_url, label_url: "" }]`, honouring
  `no_notification`. 400 if the order is held, canceled, already shipped or has a
  non-canceled label fulfillment (void it first).
- Result: order → Shipped; `shipment.created` fires like any shipment.

### Tracking sent to the channel
- Backend subscriber `seller-hub-sync.ts` also forwards `shipment.created`
  (data `{ id: <fulfillment id> }`, plus the order id when present) to
  `POST /webhooks/medusa`.
- seller-hub loads the order (items, shipping address not needed) and its
  fulfillments with `labels`, finds the connection by the order's
  `shopify_account_id` / `woocommerce_account_id` / `amazon_account_id`
  metadata, and enqueues `tracking-sync-<connection id>` job
  `{ fulfillmentId }` with jobId `tracking-<fulfillmentId>`.
- **Shopify:** `fulfillmentCreate` via the Admin GraphQL API against the
  order's fulfillment orders (open ones), with `trackingInfo { number, url,
  company }` and `notifyCustomer` from the event's `no_notification`.
- **WooCommerce:** set the order `status` to `completed` and add an order note
  with carrier + tracking number and link (WooCommerce core has no tracking
  field), idempotent by checking the note text before re-adding.
- **Amazon:** `confirmShipment` on the SP-API Orders API; implemented behind the
  existing Amazon client but not invoked in production until Amazon is live
  (the job completes as `skipped: amazon sync not live`).
- Partial shipments: each fulfillment pushes its own items; a fulfillment whose
  items are not mapped to the channel order's lines is pushed for the lines that
  match and logged for the rest.

## Architecture

```
apps/backend/src/
  workflows/void-order-label.ts, mark-order-shipped.ts, steps/...
  api/admin/orders/[id]/{void-label,mark-shipped}/route.ts + middlewares
  subscribers/seller-hub-sync.ts                (changed) forward shipment.created
packages/admin/dashboard/src/
  hooks/api/order-shipping.tsx                  new (void, mark shipped)
  routes/orders/.../row-actions-menu.tsx        (changed) Void label / Mark shipped
  routes/orders/.../mark-shipped-modal.tsx      new
  Slice A cancel guard                          (changed) non-canceled fulfillments
apps/seller-hub/src/
  webhook/server.ts                             (changed) shipment.created routing
  sync/tracking/ (resolve, shopify, woocommerce, amazon, processor)  new
  shopify|woocommerce/bootstrap.ts              (changed) tracking queue + worker
  medusa/admin-client.ts                        (changed) getOrderWithFulfillments
  db/schema.ts                                  (none: sync_job reused)
```

## Error handling

- Void refund rejected/failed: 400 with the carrier's message; nothing changes.
- Mark shipped on an ineligible order: 400 with the reason (held, canceled,
  shipped, label exists).
- Tracking push failure (channel down, 429, auth): retried with back-off up to
  the queue's attempts, then `sync_job` = failed with `last_error` (no secrets);
  a permanent 4xx (order already fulfilled/cancelled on the channel) marks it
  `skipped`/failed without retries.
- Seller-hub down when `shipment.created` fires: the subscriber logs and drops
  (as today for inventory/price); the periodic Shopify/Woo reconcile does not
  cover tracking in this slice — accepted, noted in the README.

## Testing

- **Backend:** void workflow (cancels only unshipped label fulfillments,
  rejects shipped, rejects when refund fails, idempotent when nothing to void),
  mark-shipped workflow (creates fulfillment + shipment with labels and
  `no_notification`, rejects held/canceled/shipped/label-exists), routes
  validation and error statuses; integration specs against Postgres for both
  routes (follow `order-hold-release.spec.ts`).
- **Dashboard:** Void label visibility per state, Mark shipped modal validation
  (tracking required, URL auto-fill, date), payloads, error toasts, cancel
  becomes enabled after void, counts refresh.
- **seller-hub:** subscriber forwarding; webhook routing of `shipment.created`
  to the right connection or skip; per-channel push (fake Shopify/Woo servers,
  Amazon unit-only), idempotency, retry vs permanent failure, no secrets in
  logs.
- **Regression:** Slice A, marketplace-connections and existing fulfillment
  tests pass. Before finishing: dashboard typecheck/lint/tests/build, backend
  type check/lint/unit/integration, seller-hub tsc and suite.

## Open assumptions

- Orders created by seller-hub carry `<marketplace>_account_id` metadata (true
  since the multi-connection release); older orders are not back-filled.
- A manual-fulfillment shipment is possible on these orders (shipping method
  or stock location present): the first backend task is a spike proving
  `createOrderFulfillmentWorkflow` + `createOrderShipmentWorkflow` work for an
  order without a provider-backed shipping method; if not, mark-shipped creates
  the fulfillment with the system manual provider.
- EasyPost refunds can stay `submitted` for days: the order returns to Ready to
  Ship immediately; money back is the carrier's timeline.

## Review Focus

- Void never touches a shipped/in-transit fulfillment and never leaves a bought
  label un-refunded without telling the user.
- Mark shipped cannot double-ship an order or ship a held/canceled order.
- Tracking is pushed exactly once per fulfillment per connection (idempotent),
  to the connection the order came from, never to another store.
- A channel outage never breaks Medusa's shipment flow; no secrets in logs.
- Slice A guards (held, cancel) stay correct after voids and manual shipments.
