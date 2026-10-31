# Bulk Order Fulfillment (Veeqo-style Ready to Ship)

## Context

The admin dashboard already has a "Ready to Ship" tab on the Orders page
(`packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx`),
explicitly modeled on Veeqo's fulfillment list. It already has:

- Multi-select rows (gated to orders with a shipping method) and a
  "Fulfill Selected" bulk command (`f` shortcut), calling
  `useBulkFulfillOrders` → `POST /admin/orders/fulfillments/batch`.
- Read-only **Ship From**, **Package**, and **Shipping Rate** columns.
  Ship From is resolved from the order's existing shipping method →
  shipping option → service zone → fulfillment set → location chain.
  Package is `computeOrderParcel(items)`
  (`packages/admin/dashboard/src/lib/order-parcel.ts`) — a pure function
  that sums unfulfilled item weight and takes the largest-volume item's
  dimensions. Shipping Rate just displays the order's existing shipping
  method name + amount — no live multi-carrier quote.
- A fulfillment provider, `packages/modules/providers/fulfillment-easypost`
  (design: `2026-10-16-fulfillment-easypost-design.md`), wrapping EasyPost's
  unified API. Confirmed-live carrier+service combinations (`CARRIER_SERVICE_MAP`):
  USPS (GroundAdvantage, Priority, Express) and FedEx test carrier (8 service
  levels) — 11 combos, no UPS. `calculatePrice` quotes one carrier+service at
  a time; `createFulfillment` requires `easypost_shipment_id`/`easypost_rate_id`
  that were written into `shipping_methods[0].data` by `validateFulfillmentData`
  at *checkout* time — it has no path for buying a rate the customer never
  selected.

This design upgrades that table into a fully interactive Veeqo-style bulk
fulfillment tool: an Item column with thumbnails, editable Package and Ship
From, live multi-carrier rate shopping with a picker, and ship-by-date
tracking with an Overdue flag — while fulfilling multiple orders at once,
each potentially shipping on a different carrier/service/package the admin
chose per row.

## Decisions carried into this design

- **Target page**: upgrade the existing Ready to Ship table in place, not a
  new page. Its multi-select/bulk-fulfill mechanics stay; the read-only
  cells become interactive.
- **Carrier rates**: EasyPost only (already the provider in place) — not a
  new carrier integration.
- **Rate-shopping architecture (the central fork point)**: a *new*
  fulfillment-time rate path that calls EasyPost directly, independent of
  whatever shipping option (if any) the customer picked at checkout —
  rather than restricting the admin's carrier choices to pre-configured
  shipping options and reusing checkout's `validateFulfillmentData`
  contract. The existing `createOrderFulfillmentWorkflow` gains an optional
  override input so it can accept a freshly-bought EasyPost shipment
  directly, bypassing the `shipping_methods[0].data` lookup. This is a
  small, scoped change because `packages/core/*` is vendored in this repo,
  not an external dependency.
- **Rate quoting is one EasyPost call per row, not per carrier**: EasyPost
  returns every enabled carrier's rates in a single shipment-creation
  response. A new provider method builds one shipment per row and filters
  the returned rates through the existing `CARRIER_SERVICE_MAP`.
- **Rate quoting trigger**: auto-fetch for every row on the currently
  loaded page. (The table already paginates at `PAGE_SIZE = 20` with no
  virtualization — there is no sub-page scrolling to lazily trigger off
  of, so "all rows on the current page" is already a bounded, small batch.)
  The cheapest rate is auto-selected; the full list is available in a
  dropdown.
- **Package presets**: EasyPost has no runtime "list predefined packages"
  endpoint — `predefined_package` is a fixed set of documented string
  codes per carrier (USPS flat-rate boxes/envelopes; FedEx envelope/box/
  pak/tube). The Package popover hardcodes that documented code list,
  grouped by carrier, plus a "Custom" option for manual weight/L/W/H.
  Picking a preset sends `predefined_package: "<code>"` to EasyPost instead
  of raw dimensions — EasyPost already knows that box's own size; only
  weight is still required.
- **Custom package entries are one-off**: typed weight/dimensions apply
  only to that order's fulfillment. No "save as reusable preset" feature.
- **Ship From default**: one single store-wide default stock location
  (not per sales channel), configurable in a new Settings page, with
  instant per-row override via the existing dropdown-style cell.
- **Ship-by deadline**: a per-sales-channel SLA (handling time), not a
  single store-wide rule and not a per-order field pulled from existing
  order data — e.g. Amazon and the website storefront can have different
  handling-time requirements. Piggybacks on `SalesChannel.metadata`
  (already `model.json().nullable()` — confirmed, zero migration needed)
  rather than a new data model.
- **Ship Date vs. Ship Time**: two distinct columns derived from the same
  deadline (`order.created_at` + that order's sales channel's SLA). Ship
  Date is the deadline's calendar date. Ship Time is a live countdown
  ("5h left"), rendered as an "Overdue" badge once the deadline has passed.
- **Item column multi-item display**: all line items stack vertically in
  the cell (thumbnail + title + qty each) — row height grows for
  multi-item orders rather than truncating to "+N more."
- **In-progress choices are ephemeral**: a row's picked package/ship-from/
  rate live only in the table's local state. Navigating away and back
  resets them; nothing is persisted until "Fulfill" is actually clicked.
- **Label printing**: after a successful bulk fulfill, the just-bought
  EasyPost shipments are bundled into an EasyPost `Batch` purely to call
  `generateLabel` for one consolidated label PDF, surfaced as a "Print N
  labels" link in the result summary. `Batch.buy()` itself is NOT used —
  it's asynchronous/webhook-driven (completion can take "a few seconds to
  an hour"), which conflicts with the existing result-summary UX that
  expects an immediate `{succeeded, failed}` result right after the
  mutation resolves. Buying stays a per-order, synchronous `shipment.buy()`
  loop; only label consolidation uses `Batch`.

## Goals

- An admin can select multiple Ready-to-Ship orders, review/adjust each
  one's package, ship-from location, and carrier rate, and fulfill them
  all in one action — buying real EasyPost labels per the chosen rate.
- Package selection supports both standard USPS/FedEx preset boxes and
  fully custom dimensions.
- Shipping Rate shows the cheapest available quote by default, with every
  quoted carrier+service available in a dropdown.
- Ship Date/Ship Time make SLA deadlines (varying by sales channel)
  visible at a glance, with a clear Overdue indicator.
- Item thumbnails/titles/quantities are visible directly in the table —
  no need to open the order to see what's being shipped.
- After a bulk fulfill, the admin can print all purchased labels as one
  combined PDF.

## Non-goals (explicitly out of scope for this design)

- UPS/DHL rate shopping — `CARRIER_SERVICE_MAP` only has live USPS/FedEx
  combos today; adding a carrier is a separate change to the provider,
  not this design.
- Per-sales-channel or per-order *default* Ship From location — only a
  single store-wide default plus manual per-row override.
- Saving custom package dimensions as a reusable preset.
- Persisting in-progress row choices (package/ship-from/rate) across page
  reloads or between admins.
- `Batch.buy()`-based asynchronous purchasing, or EasyPost ScanForm/Pickup
  scheduling.
- Address validation/correction (already called out as non-goal in the
  EasyPost provider design and still out of scope here).

## Architecture

```
packages/modules/providers/fulfillment-easypost/
└── src/
    ├── core/carrier-services.ts         CARRIER_SERVICE_MAP (existing, reused)
    └── services/easypost-fulfillment.ts
        + quoteAllRates(parcel, fromAddress, toAddress)   (new)
        + buyRate(shipmentId, rateId)                      (new)
        + createLabelBatch(shipmentIds, format)            (new, wraps EasyPost Batch)

packages/core/core-flows/src/order/
├── steps/bulk-fulfill-orders.ts         extended: accepts per-order
│                                          {location_id, provider_data} instead
│                                          of looping bare order_ids
└── workflows/create-fulfillment.ts      extended: new optional
                                           `provider_data_override` input,
                                           bypasses shipping_methods[0].data
                                           lookup when present

apps/backend/src/api/admin/
├── orders/[id]/carrier-rates/route.ts   NEW — POST, quotes rates for one order
├── orders/fulfillments/batch/route.ts   MODIFIED — new payload shape
└── admin/routes/settings/fulfillment/page.tsx   NEW — first custom Settings page

packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/
├── ready-to-ship-table.tsx              MODIFIED — new columns, new row state
├── item-cell.tsx                        NEW — thumbnail+title+qty, stacked
├── package-popover.tsx                  NEW — preset/custom package picker
├── ship-from-select.tsx                 NEW — replaces read-only ShipFromCell
├── shipping-rate-select.tsx             NEW — replaces read-only ShippingRateCell
├── ship-by-cell.tsx                     NEW — Ship Date + Ship Time/Overdue
└── bulk-fulfill-result-summary.tsx      MODIFIED — adds "Print N labels" link
```

### Components

- **`quoteAllRates(parcel, fromAddress, toAddress)`** (new provider method):
  creates one EasyPost shipment for the given parcel/addresses, returns
  every rate EasyPost quotes, filtered/mapped through the existing
  `CARRIER_SERVICE_MAP` the same way `getFulfillmentOptions` already
  filters discovery — sorted cheapest first. Returns the shipment's id
  alongside the rates, since buying needs it later.
- **`buyRate(shipmentId, rateId)`** (new provider method): thin wrapper
  over EasyPost's buy call, returning the bought shipment's tracking
  number, label URL, and tracking URL.
- **`createLabelBatch(shipmentIds, format)`** (new provider method): wraps
  `Batch.create({shipments})` + `Batch.buy` is *not* called — the
  shipments are already individually purchased — just
  `Batch.generateLabel(id, format)` to get one consolidated PDF URL.
- **`provider_data_override`** (new `createOrderFulfillmentWorkflow`
  input): when present, the step that normally reads
  `shippingMethod.data` to build the fulfillment provider payload uses
  this override instead. The non-override path (checkout-selected
  shipping method, unchanged) stays exactly as today — this is additive,
  not a replacement.
- **`POST /admin/orders/:id/carrier-rates`** (new route): body
  `{ location_id, parcel: { predefined_package?, weight, length?, width?, height? } }`.
  Resolves the location's address as ship-from and the order's shipping
  address as ship-to, calls `quoteAllRates`, returns the sorted rate list
  plus the shipment id.
- **`POST /admin/orders/fulfillments/batch`** (modified route): payload
  changes from `{ order_ids }` to
  `{ fulfillments: [{ order_id, location_id, shipment_id, rate_id, parcel }] }`.
  Per order: buys the chosen rate via `buyRate`, then calls
  `createOrderFulfillmentWorkflow` with `provider_data_override` set from
  the bought shipment. On success across the batch, calls
  `createLabelBatch` with all bought shipment ids and attaches the
  resulting PDF URL to the result. The single-row `FulfillConfirmPopover`
  switches to this same endpoint with a one-item array — one code path
  instead of two.
- **Settings page** (`apps/backend/src/admin/routes/settings/fulfillment/page.tsx`,
  first custom Settings page in this codebase): a stock-location picker
  (`/admin/stock-locations`) writing `Store.metadata.default_ship_from_location_id`
  via `PATCH /admin/stores/:id`, and a per-sales-channel handling-hours
  input list (`/admin/sales-channels`) writing
  `SalesChannel.metadata.handling_hours` via `PATCH /admin/sales-channels/:id`.
  Both are existing core routes — no new backend routes needed for settings.
- **`item-cell.tsx`**: renders `order.items[]` stacked — thumbnail,
  title/product title, and remaining (unfulfilled) quantity per line.
- **`package-popover.tsx`**: trigger shows the current parcel (preset name
  or "Custom — LxWxH, weight"); popover contents are a radio list of
  hardcoded USPS/FedEx predefined-package codes grouped by carrier, plus a
  "Custom" option revealing weight/L/W/H number inputs. Initial value is
  `computeOrderParcel(order.items)` (existing, reused) until overridden.
- **`ship-from-select.tsx`**: a `Select` populated from
  `/admin/stock-locations`, defaulting to the store's configured default
  location. Changing it invalidates that row's current rate quote
  (ship-from address changed) and re-fetches.
- **`shipping-rate-select.tsx`**: closed state shows the cheapest quoted
  rate (carrier + service + price); open state shows the full sorted list
  from that row's `carrier-rates` query. Picking a different rate just
  updates row state — no purchase happens until "Fulfill" is clicked.
- **`ship-by-cell.tsx`**: computed client-side from `order.created_at` +
  that order's sales channel's `metadata.handling_hours` (sales channels
  fetched once per page load, keyed by id, not per row). Renders Ship
  Date (deadline date) and Ship Time (live countdown, or a destructive
  "Overdue" `Badge` once past deadline).

## Data flow

### Rate quoting (per visible row, on page load/page change)

```
Row renders → useOrderCarrierRates(orderId, {location_id, parcel}) query
  → POST /admin/orders/:id/carrier-rates
    → resolve ship-from address (row's location) and ship-to (order's address)
    → provider.quoteAllRates(parcel, fromAddress, toAddress)
      → EasyPost: create one shipment → one response with every carrier's rates
      → filter/map through CARRIER_SERVICE_MAP, sort cheapest-first
    → return { shipment_id, rates: [...] }
  → cheapest rate auto-selected in shipping-rate-select.tsx; full list in dropdown
```

Changing Package or Ship From for a row invalidates and re-fetches that
row's quote (parcel or ship-from address changed; existing rates are no
longer valid for the new request).

### Bulk fulfill

```
Admin selects rows, clicks "Fulfill Selected"
  → confirm prompt (existing)
  → POST /admin/orders/fulfillments/batch
      { fulfillments: [{ order_id, location_id, shipment_id, rate_id, parcel }, ...] }
    per order (existing per-order try/catch preserved):
      1. provider.buyRate(shipment_id, rate_id) → bought shipment (tracking, label_url)
      2. createOrderFulfillmentWorkflow({ order_id, items, location_id,
           provider_data_override: <bought shipment data> })
      → success: add to succeeded[]; failure: add to failed[] with reason
    after the loop, if any succeeded:
      3. provider.createLabelBatch(<succeeded shipment ids>, 'pdf')
      → attach label_pdf_url to the result (best-effort; failure here doesn't
        undo the fulfillments already created)
  → { succeeded, failed, label_pdf_url? } rendered by bulk-fulfill-result-summary.tsx
```

The single-row Fulfill button in `FulfillConfirmPopover` sends the same
request shape with a one-item `fulfillments` array.

## Error handling

- **Quote failure** (EasyPost down, bad address, no live rate for that
  parcel/lane): the rate cell shows an inline error + retry; the row stays
  excluded from bulk selection until a quote succeeds — mirrors the
  existing `orderHasShippingMethod` gating pattern already used for "no
  shipping method at all."
- **Buy succeeds, fulfillment creation fails** (a real label was bought,
  but Medusa failed to record the fulfillment): that order's `failed[]`
  entry carries the bought `shipment_id`/tracking number, not just an
  error string — so it's recoverable rather than silently orphaned money.
- **Mid-batch failures don't block the rest**: the existing per-order
  try/catch in the bulk-fulfill step is preserved as-is; one order's
  EasyPost failure (expired rate, carrier rejection) doesn't stop the
  others in the same batch from fulfilling.
- **Stale rate at fulfill time** (admin waits a while after quoting;
  carrier-side rate expiry): surfaces as a `buyRate` failure, handled by
  the same per-order try/catch above — no special-casing needed.
- **Label-batch (PDF) generation failure**: non-fatal. Fulfillments that
  already succeeded stand; the result summary omits the "Print labels"
  link and shows a toast, with each order's individual label URL still
  available as a fallback.

## Testing strategy

- **Provider unit tests** (`fulfillment-easypost`): `quoteAllRates` against
  a mocked EasyPost client — correct `CARRIER_SERVICE_MAP` filtering,
  cheapest-first sort. `buyRate` and `createLabelBatch` against mocked
  buy/batch responses.
- **Workflow unit tests** (`core-flows`): `create-fulfillment` with
  `provider_data_override` set — confirms the `shipping_methods[0].data`
  lookup is skipped entirely. A regression test confirms the existing
  non-override (checkout-selected shipping method) path is unchanged.
- **HTTP integration tests** (`apps/backend/integration-tests/http`): new
  `POST /admin/orders/:id/carrier-rates` route; the modified
  `POST /admin/orders/fulfillments/batch` payload shape, covering full
  success, partial failure, and the orphaned-label-on-fulfillment-failure
  case specifically.
- **Frontend**: extend existing `ready-to-ship-table.spec.tsx`,
  `fulfill-confirm-popover.spec.tsx`, and `bulk-fulfill-result-summary.spec.tsx`
  for the new columns and payload shape. New tests for `package-popover.tsx`
  (preset vs. custom) and the new Settings page.

## Open items carried into implementation planning

- The exact hardcoded list of EasyPost `predefined_package` codes to
  support (which specific USPS/FedEx box codes to expose in the popover)
  needs to be pinned against EasyPost's current documented enum before
  implementation — not yet verified against live EasyPost docs in this
  session.
- Where exactly in `bulk-fulfill-orders.ts` / `create-fulfillment.ts` the
  `provider_data_override` plumbing needs to thread through (which step
  function signatures change) is a mechanical detail for the
  implementation plan, not resolved here.
- Whether `Store` (singular, store-wide settings) is reachable via
  `/admin/stores` as assumed, including confirming it supports a
  `metadata` field the same way `SalesChannel` does, needs verification
  during implementation — this design assumes parity based on `SalesChannel`'s
  confirmed `metadata` field but did not independently re-verify `Store`'s.
- A changeset is required for the modified `@dtc/fulfillment-easypost` and
  `core-flows` packages per `CLAUDE.md` conventions.

## Acceptance criteria for this design

- From the Ready to Ship tab, an admin can select multiple orders, see
  each one's live cheapest carrier rate (with a dropdown of all quoted
  options), adjust package/ship-from per row, and fulfill them all in one
  action.
- Each fulfilled order has a real EasyPost label bought at the rate shown
  at fulfill time, regardless of what (if anything) the customer selected
  at checkout.
- A "Print N labels" link produces one consolidated PDF of all labels
  bought in that batch.
- Ship Date/Ship Time reflect each order's sales channel's configured
  handling-time SLA, with Overdue clearly flagged once passed.
- The Item column shows thumbnail, title, and remaining quantity for
  every line item on the order, directly in the table.
- A new Settings page lets an admin set the store-wide default Ship From
  location and each sales channel's handling-time SLA.
