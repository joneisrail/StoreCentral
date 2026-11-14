# Orders Page Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Void a bought label, mark an order shipped with the user's own carrier and tracking, and push the tracking number to the Shopify / WooCommerce (and, gated off, Amazon) order the sale came from.

**Architecture:** Two backend workflows wrap Medusa's own cancel-fulfillment and create-fulfillment/create-shipment flows. A `shipment.created` event is forwarded by the existing subscriber (enriched with the order id) to seller-hub, which resolves the connection from the order's `<marketplace>_account_id` metadata and enqueues a per-fulfillment tracking job on that connection's own queue; per-channel processors push once (idempotent via `sync_job`).

**Tech Stack:** Medusa v2 workflows/admin routes (`apps/backend`, jest + integration specs against local Postgres), the dashboard fork (`packages/admin/dashboard`, vitest), seller-hub (Node 20 TypeScript ESM with `.js` suffixes, vitest, BullMQ, pg).

**Spec:** `docs/superpowers/specs/2026-11-15-orders-slice-b-design.md` (from `docs/superpowers/specs/SRS-order-management-page.md`).

**Branch/execution note:** work on a new branch `feat/orders-slice-b` from `master`.

## Global Constraints

- Medusa routes only GET/POST/DELETE; mutations through workflows (regular `function`, no async/await/conditionals/Date creation in the composition — use `transform`/`when`; `.config({name})` on repeated steps); Zod from `@medusajs/framework/zod` (v4, `z.strictObject`).
- seller-hub: `.js` import suffixes; BullMQ queue names cannot contain `:` and job ids cannot be integers; credentials/tokens never logged (log marketplace + error constructor name only); every outbound call goes through the existing clients (`ShopifyClient.graphql`, `WooCommerceClient.request`), tests use fakes — no real Shopify, WooCommerce, Amazon or EasyPost calls, no writes to the live site ai-fragrance.com.
- Dashboard strings via `t()` with keys in `packages/admin/dashboard/src/i18n/translations/en.json` and `yarn i18n:schema` regenerated; each new component in its own file.
- Existing Slice A, marketplace-connection and fulfillment behaviour/tests keep passing; known unrelated failures: 3 in `src/components/inputs/combobox/__tests__/combobox.spec.tsx`, flaky `apps/seller-hub/src/medusa/admin-client.test.ts` (getVariantPricing) and `src/queue/queues.test.ts` retry count.
- Do not start or restart any dev server; do not push or merge. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The core-flows package is loaded from a git-ignored build: after changing `packages/core/core-flows` run its build before integration specs.

## Review Focus

- Void only ever cancels non-canceled, label-bearing, not-yet-shipped fulfillments; a failed carrier refund changes nothing and tells the user.
- Mark shipped cannot double-ship, or ship a held, canceled or label-holding order.
- Tracking is pushed exactly once per fulfillment per connection, only to the connection recorded on the order, never to another store; retries do not duplicate.
- A channel outage or Amazon-not-live never breaks Medusa's shipment flow or crashes seller-hub; no secrets in logs.
- Slice A guards (held, cancel, counts) stay correct after voids and manual shipments.

---

### Task 1: Backend void-label workflow and route

**Files:**
- Create: `apps/backend/src/workflows/void-order-label.ts`, `apps/backend/src/workflows/steps/void-order-label-steps.ts`, `apps/backend/src/api/admin/orders/[id]/void-label/route.ts`
- Modify: `apps/backend/src/api/admin/orders/middlewares.ts` (add the route's middleware; follow how hold/release are registered)
- Test: `apps/backend/src/workflows/__tests__/void-order-label.unit.spec.ts`, `apps/backend/src/api/admin/orders/__tests__/void-label.unit.spec.ts`, `apps/backend/integration-tests/http/order-void-label.spec.ts`

**Interfaces:**
- Consumes: `cancelOrderFulfillmentWorkflow` (`packages/core/core-flows/src/order/workflows/cancel-order-fulfillment.ts`; read its input — `order_id`, `fulfillment_id`, `no_notification?`), the EasyPost provider's `cancelFulfillment` (refunds by `data.easypost_shipment_id`), and Slice A's `deriveFulfillmentStatus` approach (query `fulfillments.{id,packed_at,shipped_at,delivered_at,canceled_at,data,labels.*}`).
- Produces: `voidOrderLabelWorkflow` (input `{ order_id: string; user_id?: string }` → `{ order_id; voided: { fulfillment_id: string; refund_status: string | null }[] }`); `POST /admin/orders/:id/void-label` (empty strict body) → `200` that result; `404` unknown order; `400` (MedusaError NOT_ALLOWED) with a clear message when there is nothing to void, when any label fulfillment is shipped/delivered, or when the carrier refund fails/rejects.
- Behaviour: a fulfillment is voidable when it is not canceled, has `data.easypost_shipment_id`, and has no `shipped_at`/`delivered_at`. If ANY non-canceled fulfillment of the order has `shipped_at` or `delivered_at`, reject the whole request (partial shipments are not voided in this slice). Cancel each voidable fulfillment through `cancelOrderFulfillmentWorkflow` (which triggers the provider refund); capture the provider's `refund_status` when available (else null). Fail closed if `fulfillments` could not be read.

- [ ] **Step 1: Failing tests (red first).** Workflow unit tests (mocked core-flows like `hold-order.unit.spec.ts`): `voids a label fulfillment and returns its refund status`; `voids every unshipped label fulfillment`; `rejects when nothing is voidable`; `rejects when any fulfillment is shipped`; `rejects when fulfillments cannot be read`; `a refund failure surfaces as NOT_ALLOWED and no further fulfillment is attempted`. Route tests: strict empty body, 404, 400 statuses. Integration spec (copy the harness/fixtures of `order-hold-release.spec.ts` and `bulk-fulfill-orders.spec.ts` and the fake EasyPost fixture): bought-label order → void → 200, fulfillment canceled, order `not_fulfilled` again; a shipped order → 400.
- [ ] **Step 2: Run** `cd apps/backend && yarn test:unit -- void-order-label void-label` — FAIL.
- [ ] **Step 3: Implement** the steps, workflow and route (validate step → cancel loop; follow `hold-order` structure and middleware registration).
- [ ] **Step 4: Run** the new tests, `npx tsc --noEmit`, `npx medusa lint`, full `yarn test:unit` (slow; run in the background and poll), and the integration spec (`yarn test:integration:http order-void-label` or the repo's equivalent in package.json) — PASS.
- [ ] **Step 5: Commit** `feat(backend): void an order's shipping label`.

---

### Task 2: Backend mark-shipped workflow and route (with a spike)

**Files:**
- Create: `apps/backend/src/workflows/mark-order-shipped.ts`, `apps/backend/src/workflows/steps/mark-order-shipped-steps.ts`, `apps/backend/src/api/admin/orders/[id]/mark-shipped/route.ts`
- Modify: `apps/backend/src/api/admin/orders/middlewares.ts`
- Test: `apps/backend/src/workflows/__tests__/mark-order-shipped.unit.spec.ts`, `apps/backend/src/api/admin/orders/__tests__/mark-shipped.unit.spec.ts`, `apps/backend/integration-tests/http/order-mark-shipped.spec.ts`

**Interfaces:**
- Consumes: `createOrderFulfillmentWorkflow` and `createOrderShipmentWorkflow` (`packages/core/core-flows/src/order/workflows/`; shipment input: `order_id, fulfillment_id, items[{id, quantity}], labels?[{tracking_number, tracking_url, label_url}], no_notification?, created_by?`), Slice A's hold tag value `On hold` and fulfillment-status derivation.
- Produces: `markOrderShippedWorkflow` (input `{ order_id; carrier: string; tracking_number: string; tracking_url?: string; shipped_at?: string; no_notification?: boolean; location_id?: string; user_id?: string }` → `{ order_id; fulfillment_id }`); route `POST /admin/orders/:id/mark-shipped` body `z.strictObject({ carrier: z.string().trim().min(1).max(100), tracking_number: z.string().trim().min(1).max(100), tracking_url: z.url().optional(), shipped_at: z.iso.datetime().optional(), no_notification: z.boolean().optional(), location_id: z.string().optional() })` → `200 { order_id, fulfillment_id }`; `400` with a clear message when the order is held, canceled, fully shipped, or has a non-canceled label fulfillment (void it first); `404` unknown order.
- Behaviour: create a fulfillment for ALL unfulfilled items (`quantity - fulfilled_quantity > 0`) at `location_id` (default: the Settings > Fulfillment default ship-from `store.metadata.default_ship_from_location_id`, else the order's first shipping method's location), with `no_notification` passed through, then a shipment for those items with `labels: [{ tracking_number, tracking_url: tracking_url ?? "", label_url: "" }]` and `metadata`-free. The carrier name is stored on the fulfillment `data.carrier` (and on `labels`' provider via the fulfillment `metadata.carrier`). Compensation: if creating the shipment fails after the fulfillment was created, cancel that fulfillment.
- **Spike (first step):** prove `createOrderFulfillmentWorkflow` + `createOrderShipmentWorkflow` work for an order whose shipping method has no EasyPost provider (the seller-hub imported orders). If the fulfillment needs a provider-backed shipping option, use the system manual provider path (`manual_manual`) — document what you found in the report and encode it in the integration spec.

- [ ] **Step 1: Spike + failing tests (red first):** integration spec first (real harness, fixtures from `order-hold-release.spec.ts`): an order without a label → mark shipped → order `shipped`, shipment label has the tracking number, `shipment.created` event emitted; rejects held, canceled, already shipped, label-holding orders (400). Unit tests: workflow validations, fulfillment+shipment inputs (tracking_url default `""`, `no_notification` forwarded), compensation on shipment failure, route validation (empty tracking, bad URL, unknown key).
- [ ] **Step 2: Run** `yarn test:unit -- mark-order-shipped mark-shipped` — FAIL.
- [ ] **Step 3: Implement** steps, workflow, route, middleware.
- [ ] **Step 4: Run** new tests, `npx tsc --noEmit`, `npx medusa lint`, full `yarn test:unit` (background, poll), integration specs `order-mark-shipped` and the existing `order-hold-release` — PASS.
- [ ] **Step 5: Commit** `feat(backend): mark an order shipped with the user's own carrier and tracking`.

---

### Task 3: Dashboard — Void label, Mark shipped, cancel guard

**Files:**
- Create: `packages/admin/dashboard/src/hooks/api/order-shipping.tsx`, `…/order-list/components/order-list-table/components/mark-shipped-modal.tsx`
- Modify: `…/components/row-actions-menu.tsx`, `…/components/shipped-table.tsx` (action column), `en.json`, the order detail fulfillment section action menu only if a single small addition is enough (`routes/orders/order-detail/components/order-fulfillment-section/order-fulfillment-section.tsx`: add Void label to the existing fulfillment actions if a label fulfillment exists; if that screen's structure makes this large, skip it and say so)
- Test: specs next to each new/changed component and `hooks/api/__tests__/order-shipping.spec.tsx`

**Interfaces:**
- Consumes: Task 1/2 routes. Slice A: `row-actions-menu.tsx` (modes `active`/`held`), `HOLD`/`CANCEL` logic, `ORDER_VIEW_COUNTS_QUERY_KEY` + `order-query-keys.ts`, `useCancelOrder` invalidations, `fulfillments` requested as `+fulfillments.id`.
- Produces: `useVoidOrderLabel()` / `useMarkOrderShipped()` mutations (`sdk.client.fetch` POST to the new routes; invalidate order lists, the order detail, `[ORDER_VIEW_COUNTS_QUERY_KEY]`); `MarkShippedModal` (FocusModal/Drawer: carrier combobox/input with suggestions UPS, FedEx, USPS, DHL, Other; tracking number required; tracking URL optional, auto-filled from a known-carrier template when blank (UPS `https://www.ups.com/track?tracknum={n}`, FedEx `https://www.fedex.com/fedextrack/?trknbr={n}`, USPS `https://tools.usps.com/go/TrackConfirmAction?tLabels={n}`, DHL `https://www.dhl.com/en/express/tracking.html?AWB={n}`); ship date defaulting to today; "Email the customer" switch default on → `no_notification` only when off).
- Behaviour: row menu — **Mark shipped** on Ready to Ship rows (`active` mode); **Void label** where the order has a non-canceled fulfillment with `data.easypost_shipment_id` and no shipped status (request `+fulfillments.data,+fulfillments.shipped_at,+fulfillments.canceled_at` where needed; show it in the Shipped tab's action column only for `fulfilled` status — note the Shipped tab's query is `shipped/partially_shipped/partially_delivered/delivered`, so a bought-but-unshipped (`fulfilled`) order appears in NO tab today: extend `getViewQuery`/`SHIPPED_QUERY` handling by adding a small "Label bought" group to the Shipped tab (`fulfillment_status` `fulfilled` added to the Shipped view so voidable orders are findable) and update count/table together via the single `order-views.ts` source). **Slice A cancel guard change:** Cancel order is disabled only when the order has a NON-canceled fulfillment (`fulfillments.some(f => !f.canceled_at)`; request `+fulfillments.canceled_at`), so a voided order can be cancelled. Errors surface the server message in a toast; buttons disable while pending; confirm prompt before voiding ("The carrier will be asked for a refund. The order returns to Ready to Ship.").

- [ ] **Step 1: Failing tests (red first):** `Void label shown only for an unshipped label fulfillment`; `Void label hidden for shipped/delivered/canceled-only/no-label orders`; `void calls the route, shows the refund status, refreshes counts and lists`; `Mark shipped modal: tracking required, URL auto-filled per carrier, custom URL kept, date default, email toggle sends no_notification only when off`; `mark shipped success moves the row out of Ready to Ship (invalidation)`; `server 400 shows its message and keeps the modal open`; `Cancel order enabled after all fulfillments are canceled`; `getViewQuery shipped includes fulfilled and count/table share it`.
- [ ] **Step 2: Run** `cd packages/admin/dashboard && yarn test src/routes/orders src/hooks/api src/i18n` — FAIL.
- [ ] **Step 3: Implement**; add en.json keys under `orders.shipping.*`, run `yarn i18n:schema`.
- [ ] **Step 4: Run** tests, `yarn typecheck`, `npx eslint <changed files> --max-warnings 0` (pre-existing react-refresh warnings may remain) — PASS. Do not run `yarn build` here.
- [ ] **Step 5: Commit** `feat(dashboard): void label and mark shipped from the orders page`.

---

### Task 4: Backend subscriber forwards shipment.created with the order id

**Files:**
- Modify: `apps/backend/src/subscribers/seller-hub-sync.ts`
- Test: `apps/backend/src/subscribers/__tests__/seller-hub-sync.unit.spec.ts` (create it if no spec exists; follow existing subscriber test style)

**Interfaces:**
- Produces: the subscriber's `config.event` list gains `"shipment.created"`. For that event the handler resolves the owning order id of the fulfillment (`event.data.id` is the fulfillment id; use the Query graph on the `order_fulfillment` link, fields `order_id`, filter `fulfillment_id`) and forwards `POST {SELLER_HUB_WEBHOOK_URL}/webhooks/medusa` with body `{ event: "shipment.created", data: { id: <fulfillment id>, order_id: <order id>, no_notification: <boolean from event data, default false> } }`. Other events are forwarded unchanged. Failures (unresolvable order, seller-hub down, non-2xx) are logged with the event name only and never thrown.

- [ ] **Step 1: Failing tests:** `forwards shipment.created with order_id and no_notification`; `drops (logs) when the order cannot be resolved without throwing`; `inventory and price events are forwarded unchanged`; `missing SELLER_HUB_WEBHOOK_URL logs and returns`; `non-2xx and network errors never throw`.
- [ ] **Step 2: Run** `yarn test:unit -- seller-hub-sync` — FAIL.
- [ ] **Step 3: Implement.** Check the exact event name and payload against `packages/core/core-flows/src/order/workflows/create-shipment.ts` (`emitEventStep` ~line 249: `data: { id: shipment.id, no_notification }`) — shipment.id is the fulfillment id; confirm the `order_fulfillment` link entity name by querying it in the integration spec `order-mark-shipped` if needed.
- [ ] **Step 4: Run** the new tests, `npx tsc --noEmit`, `npx medusa lint` — PASS.
- [ ] **Step 5: Commit** `feat(backend): forward shipment events to seller-hub`.

---

### Task 5: seller-hub tracking plumbing (client, resolver, webhook route, queue + worker)

**Files:**
- Create: `apps/seller-hub/src/sync/tracking/types.ts`, `apps/seller-hub/src/sync/tracking/resolve.ts`, `apps/seller-hub/src/sync/tracking/processor.ts`
- Modify: `apps/seller-hub/src/medusa/admin-client.ts` (new `getOrderForTracking`), `apps/seller-hub/src/queue/queues.ts` (`SyncQueueName` gains `` `${"shopify"|"woocommerce"}-tracking-sync-${string}` ``), `apps/seller-hub/src/webhook/server.ts` + `registry.ts` (route `shipment.created`), `apps/seller-hub/src/shopify/bootstrap.ts` and `woocommerce/bootstrap.ts` (tracking queue + worker + `trackingQueue` in the runtime's webhook deps), `apps/seller-hub/src/connectors/manager.ts` only if the runtime shape needs it
- Test: next to each file (`resolve.test.ts`, `processor.test.ts`, `admin-client` test additions, `server.test.ts`, bootstrap tests, `registry.test.ts`)

**Interfaces:**
- Produces `types.ts`:
  ```ts
  export type TrackingJobData = { fulfillmentId: string; orderId: string; noNotification: boolean }
  export type TrackingOrder = {
    id: string
    metadata: Record<string, unknown>
    items: { id: string; sku: string | null; quantity: number }[]
    fulfillments: {
      id: string; canceledAt: string | null
      items: { lineItemId: string; quantity: number }[]
      labels: { trackingNumber: string; trackingUrl: string | null }[]
      carrier: string | null            // fulfillment.data.carrier ?? provider-derived
    }[]
  }
  export type TrackingPush = (ctx: {
    order: TrackingOrder; fulfillment: TrackingOrder["fulfillments"][number]
    externalOrderId: string; noNotification: boolean
  }) => Promise<"pushed" | "skipped">
  ```
- Produces `MedusaAdminClient.getOrderForTracking(orderId): Promise<TrackingOrder | null>` (GET `/admin/orders/:id` with `fields=id,metadata,items.id,items.variant_sku,items.quantity,fulfillments.id,fulfillments.canceled_at,fulfillments.data,fulfillments.items.line_item_id,fulfillments.items.quantity,fulfillments.labels.tracking_number,fulfillments.labels.tracking_url`; 404 → null; reuse `authedFetchRaw`/`throwIfNotOk`).
- Produces `resolve.ts`: `resolveTrackingTarget(metadata): { marketplace: "shopify" | "woocommerce" | "amazon"; accountId: string; externalOrderId: string } | null` using `shopify_account_id`+`shopify_order_id`, `woocommerce_account_id`+`woocommerce_order_id`, `amazon_account_id`+`amazon_order_id` (read the three import adapters `sync/shopify-import-order.ts`, `woocommerce-import-order.ts`, `sync/import-order.ts` for the exact metadata keys); null when absent (manual/web orders → skip silently).
- Produces `processor.ts`: `processTrackingJob(job: TrackingJobData, deps: { pool; medusaClient; integrationAccountId; marketplace; push: TrackingPush }): Promise<{ status: "pushed" | "skipped" | "recovered" }>` — claims a `sync_job` row (`sync_type: 'tracking'`, `external_id: fulfillmentId`, unique per account; follow `queue/sync-job-tracking.ts` and `sync/shopify-order-sync-processor.ts` for the claim/succeed/fail helpers and the permanent-vs-transient error classification), loads the order, skips (status `skipped`, success) when the order has no target for THIS account, when the fulfillment is canceled or has no label/tracking number, or when already `succeeded`; otherwise calls `push` and records the result. Permanent errors are classified like the order-sync processors (no retry); transient errors rethrow for BullMQ back-off. Never log tokens or full error messages.
- Webhook: `routeEvent` for `shipment.created` (body `data: { id, order_id, no_notification }`) stays cheap and never calls Medusa. It enqueues a `TrackingJobData` job (`{ fulfillmentId: data.id, orderId: data.order_id, noNotification: data.no_notification === true }`) on EVERY live Shopify and WooCommerce connection's tracking queue with jobId `tracking-<fulfillmentId>-<accountId>`; the worker (`processTrackingJob`) loads the order and skips with status `skipped` when the order does not belong to its own connection, so only the owner pushes. Enqueue failures are logged (event name + constructor name) and isolated per connection; the HTTP response stays 200. Amazon has no runtime, so nothing is enqueued for it.

- [ ] **Step 1: Failing tests:** `getOrderForTracking maps fields and returns null on 404`; `resolveTrackingTarget picks the marketplace/account/external id and returns null for orders without account metadata`; processor: `pushes once and records succeeded`, `second delivery of the same fulfillment is recovered/skipped without pushing`, `order of another account is skipped`, `canceled fulfillment or missing tracking number is skipped`, `transient error rethrows and leaves the job retryable`, `permanent error is recorded failed without retry`, `no secrets in logs`; webhook: `shipment.created enqueues one job per live connection with jobId tracking-<fulfillment>-<account>`, `unknown/other events unchanged`, `enqueue failure on one connection does not affect the others or the 200`; bootstrap: `tracking queue and worker are created per connection with the account-suffixed name and closed on stop`.
- [ ] **Step 2: Run** `cd apps/seller-hub && npx vitest run src/sync/tracking src/webhook src/shopify src/woocommerce src/medusa` — FAIL.
- [ ] **Step 3: Implement.** The worker in each bootstrap calls `processTrackingJob` with a `push` supplied by Tasks 6/7 (for now a function that throws `Error("not implemented")` is NOT acceptable — wire a `push` parameter on the bootstrap deps defaulting to the real implementations added in Tasks 6/7; in this task inject a no-op test double in tests and make the bootstrap default a function returning `"skipped"` until Task 6/7 replace it, with a TODO-free clear name `pushTrackingNotYetImplemented`).
- [ ] **Step 4: Run** the new tests, `npx tsc --noEmit`, full `npx vitest run` — PASS (known flakes aside).
- [ ] **Step 5: Commit** `feat(seller-hub): tracking job plumbing for shipped orders`.

---

### Task 6: seller-hub Shopify tracking push

**Files:**
- Create: `apps/seller-hub/src/sync/tracking/shopify-push.ts`
- Modify: `apps/seller-hub/src/shopify/bootstrap.ts` (use the real push)
- Test: `apps/seller-hub/src/sync/tracking/shopify-push.test.ts`

**Interfaces:**
- Consumes: `ShopifyClient.graphql<T>(query, variables)`, `TrackingPush` and types from Task 5.
- Produces: `createShopifyTrackingPush(client: ShopifyClient): TrackingPush`. Behaviour: build the order gid `gid://shopify/Order/<externalOrderId>`; query its open fulfillment orders (`fulfillmentOrders(first: 20) { nodes { id status lineItems(first: 50) { nodes { id sku remainingQuantity } } } }`); pick the lines that match the Medusa fulfillment's items by SKU and quantity (fall back to all remaining lines of open fulfillment orders when the fulfillment covers every item); run `fulfillmentCreate` with `{ notifyCustomer: !noNotification, trackingInfo: { company, number, url }, lineItemsByFulfillmentOrder }`. If Shopify reports no open fulfillment orders (already fulfilled) return `"skipped"`. GraphQL `userErrors` → a permanent error unless the code indicates throttling; throttled → transient. **The exact GraphQL field/mutation names must be checked against the Shopify Admin API docs for the version in `shopify/config.ts`'s API version; they are unverified against a real store — say so in the report.**

- [ ] **Step 1: Failing tests (fake client capturing queries):** `fulfills matching lines with tracking info and notifyCustomer true`; `notifyCustomer false when no_notification`; `already-fulfilled order returns skipped`; `userErrors become a permanent error`; `throttled becomes a transient error`; `partial fulfillment sends only matching lines`; `tracking company/number/url are passed as given and never logged`.
- [ ] **Step 2: Run** `npx vitest run src/sync/tracking/shopify-push.test.ts` — FAIL.
- [ ] **Step 3: Implement**, then wire the real push into `shopify/bootstrap.ts` (tests for the bootstrap use an injected push).
- [ ] **Step 4: Run** the tests, `npx tsc --noEmit`, `npx vitest run src/sync/tracking src/shopify` — PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): push tracking to Shopify`.

---

### Task 7: seller-hub WooCommerce tracking push

**Files:**
- Create: `apps/seller-hub/src/sync/tracking/woocommerce-push.ts`
- Modify: `apps/seller-hub/src/woocommerce/bootstrap.ts`
- Test: `apps/seller-hub/src/sync/tracking/woocommerce-push.test.ts`

**Interfaces:**
- Consumes: `WooCommerceClient.request(method, path, { query, body })` (`apps/seller-hub/src/woocommerce/client.ts`), Task 5 types.
- Produces: `createWooCommerceTrackingPush(client): TrackingPush`. Behaviour: `GET /wp-json/wc/v3/orders/<id>/notes` (check the client's `baseUrl` convention for the exact prefix) and skip adding a note whose text already contains the tracking number (idempotency); add `POST /orders/<id>/notes { note: "Shipped via <carrier>. Tracking: <number> <url>", customer_note: !noNotification }`; then `PUT /orders/<id> { status: "completed" }` unless the order is already `completed`/`refunded`/`cancelled` (read `GET /orders/<id>` first; return `"skipped"` for cancelled/refunded). Order id comes from `externalOrderId`. 404 → permanent error; 5xx/429 → transient.

- [ ] **Step 1: Failing tests (fake client):** `adds a customer note with carrier, number and link, then completes the order`; `no note duplication when the note already exists`; `customer_note false when no_notification`; `already completed order only checks notes`; `cancelled/refunded order is skipped`; `404 permanent, 429/5xx transient`; `values never logged`.
- [ ] **Step 2: Run** `npx vitest run src/sync/tracking/woocommerce-push.test.ts` — FAIL.
- [ ] **Step 3: Implement**, wire into `woocommerce/bootstrap.ts`.
- [ ] **Step 4: Run** tests, `npx tsc --noEmit`, `npx vitest run src/sync/tracking src/woocommerce` — PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): push tracking to WooCommerce`.

---

### Task 8: Amazon confirmShipment (built, gated off) and an end-to-end test

**Files:**
- Create: `apps/seller-hub/src/sp-api/confirm-shipment.ts`, `apps/seller-hub/src/sp-api/confirm-shipment.test.ts`, `apps/seller-hub/src/sync/tracking/tracking.e2e.test.ts`
- Modify: `apps/seller-hub/src/sp-api/` index exports if present; README

**Interfaces:**
- Consumes: the existing SP-API client (`apps/seller-hub/src/sp-api/` — read how `getOrder` calls it) and Task 5/6/7.
- Produces: `confirmShipment(spApiClient, { amazonOrderId, carrierCode, trackingNumber, shipDate, items: { orderItemId: string; quantity: number }[] }): Promise<void>` calling `POST /orders/v0/orders/{amazonOrderId}/shipmentConfirmation` with `{ marketplaceId, packageDetail: { packageReferenceId: "1", carrierCode, trackingNumber, shipDate, orderItems } }` (verify field names against the SP-API Orders v0 docs; unverified against Amazon — say so). It is NOT wired to a worker: Amazon tracking jobs are skipped while Amazon is not live (no runtime exists). The e2e test (fake Shopify and WooCommerce servers, real pool test style from `connections.e2e.test.ts` / `shopify-sync.e2e.test.ts`) covers: a Medusa `shipment.created` webhook for an order from connection A pushes tracking to A only and not to B; replaying the webhook does not push twice; a manual order (no account metadata) is skipped; a channel 5xx retries then succeeds without duplicates.

- [ ] **Step 1: Failing tests:** `confirmShipment sends the documented body and path`; `propagates SP-API errors without logging the body`; the four e2e cases above.
- [ ] **Step 2: Run** `npx vitest run src/sp-api src/sync/tracking` — FAIL.
- [ ] **Step 3: Implement.** README: document the `shipment.created` flow, that Amazon tracking is built but off until Amazon is live, that old orders are not back-filled, and that a seller-hub outage at shipment time drops that push (no catch-up in this slice).
- [ ] **Step 4: Run** the tests, `npx tsc --noEmit`, full `npx vitest run` — PASS (known flakes aside).
- [ ] **Step 5: Commit** `feat(seller-hub): Amazon shipment confirmation (gated) and tracking end-to-end tests`.

---

### Task 9: Full verification and hand-off

**Files:** none new; fix anything the checks surface in the owning task's files.

- [ ] **Step 1:** `cd apps/seller-hub && npx tsc --noEmit && npx vitest run` — PASS (known flakes aside).
- [ ] **Step 2:** `cd apps/backend && npx tsc --noEmit && npx medusa lint && yarn test:unit`, then the integration specs `order-void-label`, `order-mark-shipped`, `order-hold-release`, `bulk-fulfill-orders` (rebuild `packages/core/core-flows` first if it changed) — PASS.
- [ ] **Step 3:** `cd packages/admin/dashboard && yarn typecheck && yarn test` (known 3 combobox failures only; confirm that file is untouched), eslint on the changed files, then `yarn build` (refreshes the served dist). No dev server started.
- [ ] **Step 4:** Grep the diff for secret/PII logging (no new `console.*` interpolating tokens, tracking URLs with credentials, addresses or emails), and confirm only intended files changed outside Slice B.
- [ ] **Step 5:** Write the hand-off note (not committed): rebuild core-flows only if it changed, restart seller-hub then backend, and the owner's manual checks (void a test label, mark an order shipped with a made-up tracking number and see the Shopify/WordPress test order receive it).
- [ ] **Step 6: Commit** only if fixes were needed: `chore: fixes from final verification`.
