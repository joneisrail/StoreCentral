# EasyPost Fulfillment Provider

## Context

Today, `test-project/apps/backend` runs on Medusa's bare default — no fulfillment module customization in `medusa-config.ts` at all, which means it's implicitly using Medusa's built-in `manual` provider (`@medusajs/fulfillment-manual`). There is no real carrier integration: no live shipping rates at checkout, no label purchase, no tracking.

This project adds a new Medusa fulfillment provider backed by [EasyPost](https://www.easypost.com/) — a multi-carrier shipping API — so the store can show real carrier rates at checkout, buy real shipping labels when an order is fulfilled, and automatically track delivery status.

Unlike the Seller Hub Amazon sync engine (business-specific middleware deliberately kept out of StoreCentral's `packages/`), a shipping provider is exactly what Medusa's provider plugin system is built for. StoreCentral already ships this exact kind of code — `packages/modules/providers/fulfillment-manual` and `packages/modules/providers/payment-stripe` are the established pattern a new provider should follow.

## Decisions carried into this design

- **Scope**: real shipping rates at checkout (not just label purchase on an already-flat-rate order) plus label purchase + tracking on fulfillment — the primary goal selected over "label/tracking only" and "address validation only." Address validation itself is not in this design's scope; see Non-goals.
- **Carriers**: not hardcoded to a fixed list (e.g. "just USPS") — the provider reflects whatever carriers are actually enabled on the connected EasyPost account, discovered live via EasyPost's Carrier Accounts API.
- **Checkout UX**: customers see multiple real, separately-priced shipping options (e.g. "USPS Priority — $8.20" and "UPS Ground — $11.50"), not a single collapsed "cheapest rate" line. This is the resolution to a real tension: EasyPost has no endpoint that returns "available services" independent of an actual rate request, so service levels per carrier (USPS: First/Priority/Express; UPS: Ground/2ndDayAir/NextDayAir; etc.) come from a small built-in map of each carrier's own fixed, documented vocabulary — not a business-policy carrier allowlist.
- **Parcel sizing**: real per-item `weight`/`length`/`height`/`width` from each cart line item's variant when set, falling back to a configured default per item when missing. Confirmed via a direct DB check that the demo catalog currently has these fields `null` on every variant, so every rate request today uses the fallback — expected, and self-corrects as real product data gets filled in.
- **Label purchase trigger**: fulfillment auto-buys the exact rate the customer selected at checkout (not a fresh re-shop, and not a second manual admin pick). Mechanically: EasyPost ties a `rate_id` to a specific `shipment` object, so the rate chosen at checkout is persisted and bought by that same `rate_id` later, guaranteeing the same price.
- **Tracking**: wired up now via EasyPost's webhooks, mapped onto Medusa's existing `createShipmentWorkflow`/`markFulfillmentAsDeliveredWorkflow` (both already exist in `@medusajs/core-flows` — this is not new workflow logic, just a new caller).
- **Returns & cancellation**: both included in this design (`createReturnFulfillment`, `cancelFulfillment`), not deferred — small marginal cost on top of the core rate/buy flow already being built.
- **Package location**: `packages/modules/providers/fulfillment-easypost` in StoreCentral, scoped `@dtc/fulfillment-easypost` (not `@medusajs/*` — that scope is Medusa's own first-party packages; this isn't one, even though it lives in the same directory by function).
- **EasyPost account**: user will obtain a free EasyPost test-mode API key alongside this work (no approval wait, unlike Amazon SP-API) — test-mode calls hit real EasyPost infrastructure and return real-shaped data, just against fake carriers that never actually ship. This means, unlike Seller Hub, integration tests can hit a real external API rather than only fakes/mocks.

## Goals

- Real, live carrier rates at checkout, reflecting the connected EasyPost account's actually-enabled carriers.
- Customers choose between multiple real shipping options at checkout, each separately priced.
- Fulfilling an order in the Medusa admin automatically buys the exact rate the customer paid for and returns a real tracking number + label.
- Fulfillment status (shipped, delivered) updates automatically as EasyPost reports tracking events, with no manual checking.
- Returns and label voiding/refunds are supported through the same provider.

## Non-goals (explicitly out of scope for this design)

- Address validation/correction as a standalone checkout step. (EasyPost's address verification is a real capability and could be added later as part of `validateFulfillmentData`, but it wasn't selected as in-scope for this pass — the user's answer to "what's the main thing you need EasyPost for" was rate+label, and address validation was one of three options not chosen. Noted here so it isn't silently forgotten.)
- Multi-warehouse / multi-origin shipping (a single `from_location` per shipment is assumed, matching Medusa's own `CartPropsForFulfillment.from_location: StockLocationDTO` — singular, not an array).
- International customs forms/duties. EasyPost supports this, but nothing in this design's scope (demo catalog, demo addresses) currently exercises international shipping.
- A UI for admins to manage EasyPost carrier accounts, webhooks, or API keys — these are configured directly in the EasyPost dashboard and via `medusa-config.ts` provider options, same as `payment-stripe`'s `apiKey`/`webhookSecret`.

## Architecture

```
packages/modules/providers/fulfillment-easypost/      (StoreCentral)
├── package.json            name: "@dtc/fulfillment-easypost"
├── tsconfig.json
├── jest.config.js
├── src/
│   ├── index.ts                        module definition, exports the service
│   ├── core/
│   │   └── easypost-client.ts          thin wrapper around @easypost/api SDK
│   └── services/
│       ├── easypost-fulfillment.ts     AbstractFulfillmentProviderService impl
│       └── __tests__/

test-project/apps/backend/                            (test-project)
├── medusa-config.ts                    + one new `modules` entry registering
│                                         @dtc/fulfillment-easypost, with
│                                         { apiKey, webhookSecret, defaultParcel }
└── src/api/webhooks/easypost/
    └── route.ts                        the ONE new apps/backend file this
                                          design needs — see "Why a separate
                                          webhook route" below
```

### Components

- **`EasyPostClient`** (`core/easypost-client.ts`): wraps the official `@easypost/api` npm SDK (StoreCentral's own `payment-stripe` provider uses the official `stripe` SDK the same way — unlike Seller Hub's standalone-app convention of avoiding new deps, a provider *package* follows the provider convention instead). Exposes the handful of operations this provider actually needs: list carrier accounts, create a shipment (get rates), buy a shipment by rate id, refund a shipment, create a return shipment.
- **`EasyPostFulfillmentService`** (`services/easypost-fulfillment.ts`): the `AbstractFulfillmentProviderService` implementation — `getFulfillmentOptions`, `validateFulfillmentData`, `canCalculate`, `calculatePrice`, `createFulfillment`, `cancelFulfillment`, `createReturnFulfillment`. This is the only piece Medusa's module system loads; everything else is a private implementation detail of this package.
- **Carrier→service map**: a small, static lookup (e.g. `{ USPS: ["First", "Priority", "Express"], UPS: ["Ground", "2ndDayAir", "NextDayAir"], ... }`) modeling EasyPost's own fixed per-carrier vocabulary — used by `getFulfillmentOptions` to expand "carriers enabled on this account" into selectable options.
- **Webhook route** (`apps/backend/src/api/webhooks/easypost/route.ts`): the one file outside the package. Verifies EasyPost's HMAC signature against `req.rawBody` (confirmed available on every Medusa request — this is how the existing `/hooks/payment/[provider]/route.ts` already does payment webhook verification, so this isn't a new framework capability, just reused), looks up the Medusa fulfillment whose stored `data.easypost_tracking_code` matches the webhook's tracking code, and calls `createShipmentWorkflow`/`markFulfillmentAsDeliveredWorkflow` (both already exist in `@medusajs/core-flows`) to update its status.

### Why a separate webhook route (not inside the package)

Medusa's core only has a generic webhook-ingestion route for *payment* providers (`packages/medusa/src/api/hooks/payment/[provider]/route.ts`) — there is no fulfillment equivalent, confirmed by searching the actual route tree. A provider package cannot inject HTTP routes into the host application; Medusa's API router only scans the consuming app's own `src/api/` directory. So EasyPost's tracking webhook needs exactly one new file in `test-project/apps/backend`, the same shape as Seller Hub needing exactly one new `apps/backend` subscriber file for its own integration.

## Data flow

### Rate shopping at checkout

1. Admin creates a shipping option in the Medusa dashboard with `price_type: "calculated"`, picking one of the options `getFulfillmentOptions()` returned (e.g. "USPS Priority").
2. `getFulfillmentOptions()` calls EasyPost's `GET /carrier_accounts` to find which carriers are actually enabled, expands each via the carrier→service map, and returns one `FulfillmentOption` per carrier+service combination.
3. When a customer views checkout, Medusa calls `calculatePrice(optionData, data, context)` for each calculated shipping option on the cart. `context` (confirmed against the real `CalculateShippingOptionPriceDTO` type) already carries `context.shipping_address` (destination), `context.from_location` (origin stock location), and `context.items[].variant.{weight,length,height,width}` (per-item parcel data).
4. The implementation builds a parcel (summing real item weight/dims, falling back to the configured default for anything missing), requests rates from EasyPost for that specific shipment, and returns the rate matching `optionData`'s carrier+service as `calculated_amount`.
5. If EasyPost can't quote that specific carrier+service for the destination (e.g. USPS won't service a given address), the option simply fails to price — Medusa's existing behavior drops it from checkout rather than blocking the page.

### Label purchase on fulfillment

1. When the shipping method is actually added to the cart, `validateFulfillmentData(optionData, data, context)` requests/confirms an EasyPost shipment + matching `rate_id` for the chosen carrier+service, and returns `{ ...data, easypost_shipment_id, easypost_rate_id }` — Medusa persists this onto the shipping method's `data`.
2. When admin fulfills the order, `createFulfillment(data, items, order, fulfillment)` reads `data.easypost_shipment_id`/`easypost_rate_id` and calls EasyPost's buy endpoint with that exact `rate_id` — not a fresh rate shop.
3. Returns `{ data: { ...everything above, easypost_tracking_code, easypost_label_url }, labels: [{ tracking_number, tracking_url, label_url }] }` — this exact shape was confirmed against the real `CreateFulfillmentResult` type in `packages/core/types/src/fulfillment/provider.ts`.

### Tracking updates

1. EasyPost POSTs a tracking event to the webhook route, wrapped as `{ description: "tracker.updated", result: { tracking_code, status, ... } }`.
2. The route verifies the HMAC signature against the raw body, looks up the fulfillment by `data.easypost_tracking_code`, and maps EasyPost's status onto the right core-flows workflow call (`createShipmentWorkflow` for in-transit-type statuses, `markFulfillmentAsDeliveredWorkflow` for `delivered`).
3. Returns `200` immediately either way — EasyPost's payload is self-contained, so (unlike the payment webhook route) there's no need for the delayed-event-bus indirection; the route handles the update inline.

### Cancellation & returns

- `cancelFulfillment(data)` calls EasyPost's refund endpoint for the purchased label. EasyPost refunds aren't instant (the carrier has to approve them), so this submits the request and returns immediately; the eventual refund outcome arrives later through the same tracking webhook route, as a different event type.
- `createReturnFulfillment(fulfillment)` runs the same shipment/rate/buy flow as `createFulfillment`, with the from/to addresses swapped (customer → stock location instead of the reverse).

## Error handling

- A rate request that can't quote a given carrier+service for the destination fails that one option's price silently (per Medusa's own existing checkout behavior) rather than blocking checkout.
- `createFulfillment`/`createReturnFulfillment` failures (EasyPost API error, insufficient address data, expired rate) throw and surface as a failed fulfillment attempt in the admin — no partial/ambiguous state, consistent with how this codebase has treated "don't create a half-finished side effect" everywhere else (Seller Hub's order-import idempotency being the clearest precedent).
- The webhook route rejects with `401` on a signature mismatch, and must never throw an unhandled exception on a malformed payload (same "entry point fed by an external system must not crash the process" principle the Seller Hub webhook/SQS consumer code already follows).

## Testing strategy

- Tests hit the **real EasyPost test-mode API**, not fakes/mocks, wherever the test-mode account can exercise the real behavior (rate shopping, label purchase, refund) — consistent with how this codebase prefers real external test infra over mocks whenever it's available (Seller Hub's Medusa-backend integration tests are the precedent; this is actually a strictly better position than Seller Hub had with Amazon SP-API, since EasyPost's test mode requires no approval wait).
- The webhook signature verification is the one piece that needs a fabricated payload + matching signature in tests, since there's nothing to "really" receive from EasyPost in a unit test.
- Follows StoreCentral's own testing conventions for provider packages (Jest, `__tests__/` alongside source) rather than Seller Hub's Vitest/real-Postgres conventions — this package lives in StoreCentral, not `test-project`.

## Open items carried into implementation planning

- Exact mapping from EasyPost tracking `status`/`status_detail` values to Medusa's fulfillment lifecycle states needs to be pinned down against EasyPost's actual documented status enum before implementing the webhook route — not yet verified against live EasyPost traffic.
- The specific query/lookup mechanism for "find the Medusa fulfillment whose `data.easypost_tracking_code` matches X" (a DB query via the fulfillment module's own query/repository layer vs. some other mechanism) needs to be worked out against Medusa's actual query capabilities for `data`-column fields — not a user-facing decision, but a real implementation detail.
- The carrier→service map (which specific service-level strings each carrier uses, e.g. USPS's exact service name constants) needs to be confirmed against EasyPost's current API docs before implementing `getFulfillmentOptions` — same class of "model the external system's real fixed vocabulary, don't guess" discipline Seller Hub's SP-API integration followed throughout.
- A changeset is required for this new package per `CLAUDE.md` (patch bump, since it's a new addition).

## Acceptance criteria for this design

- A shipping option backed by this provider, added at checkout, shows a live rate from the connected EasyPost test-mode account that reflects the cart's real destination and (once product weights exist) real parcel size.
- Fulfilling an order with such a shipping option buys a real EasyPost test-mode label at the exact rate quoted at checkout, and the order shows a tracking number + label URL.
- A tracking webhook event for that shipment updates the order's fulfillment status in Medusa without manual intervention.
- Canceling a fulfillment and creating a return both complete through the same provider, using real EasyPost test-mode calls.
