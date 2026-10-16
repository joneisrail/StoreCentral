# EasyPost Fulfillment Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real EasyPost-backed fulfillment provider to StoreCentral so `test-project`'s storefront shows live, multi-carrier shipping rates at checkout, admin fulfillment auto-buys the exact rate quoted, and tracking status updates automatically via webhook.

**Architecture:** A new StoreCentral package (`packages/modules/providers/fulfillment-easypost`, scoped `@dtc/fulfillment-easypost`) implements `AbstractFulfillmentProviderService` against the real EasyPost test-mode API — carrier discovery, rate shopping, label purchase, cancellation, and returns. Because Medusa's core only has a webhook-ingestion route for payment providers, tracking updates need one new file in `test-project/apps/backend` (a webhook route) that looks the fulfillment up by the EasyPost tracking code the provider already stored on the fulfillment's own `data`, then calls existing `@medusajs/core-flows` workflows to update its status.

**Tech Stack:** TypeScript, Jest (package tests), `@easypost/api` (official EasyPost Node SDK), Medusa v2's `AbstractFulfillmentProviderService`, `@medusajs/core-flows`.

**Spec:** `docs/superpowers/specs/2026-10-16-fulfillment-easypost-design.md`

## Global Constraints

- No changes to Medusa core logic in `packages/core/` or `packages/medusa/` — this is a new provider package plus, per the spec's own analysis, exactly one new application-level file in `test-project/apps/backend` (the webhook route), the same shape as every other provider package in this repo.
- Package scope is `@dtc/fulfillment-easypost`, not `@medusajs/*` — that scope is reserved for Medusa's own first-party packages (per the spec's explicit naming decision).
- Carriers are never hardcoded as a fixed allowlist — `getFulfillmentOptions()` must reflect what's actually enabled on the connected EasyPost account, discovered live.
- Parcel weight/dimensions: sum real per-item variant values when set; fall back to a configured default per missing item (per the spec; the current demo catalog has every variant's weight/dimensions `null`, confirmed by direct DB query, so every parcel today exercises the fallback path — this must be tested, not just asserted).
- Fulfillment buys the *exact* rate quoted at checkout (the `rate_id` persisted by `validateFulfillmentData`), never a fresh re-shop at fulfillment time.
- A changeset is required for this new package (`patch`, per CLAUDE.md's rule for new/non-breaking additions).
- Tests for the EasyPost-facing logic hit the real EasyPost test-mode API (an `EASYPOST_API_KEY` env var pointing at a real test-mode key), not a fake HTTP client — consistent with the spec's testing-strategy decision. Medusa-shaped inputs (`context`, `order`, `fulfillment`) are plain JS objects matching the real DTOs, not a live Medusa backend — this package has none, matching `payment-stripe`'s own established testing convention (confirmed by reading `payment-stripe/src/core/__tests__/stripe-base.spec.ts`, which uses fake Stripe keys and plain-object inputs, not a live Stripe account or a live Medusa app).

## Review Focus

- **EasyPost can't quote a given carrier+service for a specific destination** (e.g. a PO box USPS won't deliver to, or an address outside a carrier's service area) — `calculatePrice` must fail that one option gracefully (so Medusa drops it from checkout) rather than throwing in a way that blocks the whole cart from pricing. Covered by Task 4's "unquotable destination" test.
- **Webhook payload doesn't match any known fulfillment** (a tracking code for an order from before this provider existed, a malformed/replay payload, or a genuinely unknown tracker) — the webhook route must log and return a safe response, never crash the process. Covered by Task 8's "unknown tracking code" and "malformed body" tests.
- **The connected EasyPost account has zero carriers enabled** (a brand-new/misconfigured account) — `getFulfillmentOptions()` must return an empty list, not throw, so Medusa's admin doesn't hard-fail when setting up shipping options for the first time. Covered by Task 2's "no carrier accounts" test.
- **Buying a rate that's expired or already been bought** (EasyPost rates have a validity window; a customer's cart can sit for a while before fulfillment, or a duplicate fulfillment-create call could race) — `createFulfillment` must surface a clear error rather than silently returning a wrong/empty result, and must not buy the same shipment twice. Covered by Task 5's "expired rate" and "already fulfilled" tests.
- **A webhook signature that doesn't verify** (wrong secret, tampered payload, or a non-EasyPost sender probing the endpoint) — the route must reject with `401` before touching any Medusa data, never process an unverified payload "just to be safe." Covered by Task 8's "bad signature" test.

---

## Task 1: Scaffold the `fulfillment-easypost` package + EasyPost client core

**Files:**
- Create: `packages/modules/providers/fulfillment-easypost/package.json`
- Create: `packages/modules/providers/fulfillment-easypost/tsconfig.json`
- Create: `packages/modules/providers/fulfillment-easypost/jest.config.js`
- Create: `packages/modules/providers/fulfillment-easypost/src/core/easypost-client.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/core/__tests__/easypost-client.spec.ts`

**Interfaces:**
- Produces: `EasyPostClient` — a thin wrapper class around the official `@easypost/api` SDK, constructed as `new EasyPostClient({ apiKey: string })`. Methods: `listCarrierAccounts(): Promise<CarrierAccount[]>`, `createShipment(input: CreateShipmentInput): Promise<EasyPostShipment>`, `buyShipment(shipmentId: string, rateId: string): Promise<EasyPostShipment>`, `refundShipment(shipmentId: string): Promise<EasyPostShipment>`, `verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string, secret: string): boolean`. The exact shapes of `CarrierAccount`/`CreateShipmentInput`/`EasyPostShipment` are pinned by Step 1 below against the real installed SDK's own TypeScript types — do not guess field names before reading them.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Scaffold package.json/tsconfig.json/jest.config.js**

Copy the exact shape of `packages/modules/providers/payment-stripe`'s `package.json`/`tsconfig.json`/`jest.config.js`, with these changes: `name: "@dtc/fulfillment-easypost"`, `description: "EasyPost fulfillment provider for Medusa"`, remove the `repository`/`bugs` fields (those point at medusajs/medusa, which is wrong for a third-party package — omit them entirely rather than invent new ones), dependency `"@easypost/api": "^<latest stable>"` (check npm for the current stable major version before pinning — do not copy a version number from memory). Run `yarn install` at the repo root afterward so the new workspace package and its dependency resolve.

- [ ] **Step 2: Read the installed `@easypost/api` package's TypeScript types**

Before writing any client code, open `node_modules/@easypost/api`'s type definitions (or its README/source if types are thin) and confirm: the client constructor's exact signature, the method names/namespaces for listing carrier accounts, creating a shipment, buying a shipment by rate, and refunding a shipment, and the exact response field names for a `Rate` object (carrier, service, rate amount, currency) and a bought `Shipment` (tracking code, label URL, tracker object). Write down what you find in your own words as a comment block at the top of `easypost-client.ts` before implementing — this is what later tasks will rely on verbatim, so get it right here rather than approximating.

- [ ] **Step 3: Write the failing tests**

```ts
test("listCarrierAccounts returns the real test-mode account's enabled carriers", async () => {
  const client = new EasyPostClient({ apiKey: process.env.EASYPOST_API_KEY! })
  const accounts = await client.listCarrierAccounts()
  expect(Array.isArray(accounts)).toBe(true)
  // A fresh EasyPost test-mode account always has at least the built-in
  // USPS test carrier enabled by default -- assert on that rather than an
  // exact count, which could change if the test account's own carriers change.
  expect(accounts.length).toBeGreaterThan(0)
})

test("createShipment returns real rates for a real test-mode shipment", async () => {
  const client = new EasyPostClient({ apiKey: process.env.EASYPOST_API_KEY! })
  const shipment = await client.createShipment({
    toAddress: { name: "Test Buyer", street1: "417 montgomery st", city: "San Francisco", state: "CA", zip: "94104", country: "US" },
    fromAddress: { name: "Test Seller", street1: "118 2nd street", city: "San Francisco", state: "CA", zip: "94105", country: "US" },
    parcel: { weight: 16, length: 10, width: 8, height: 4 },
  })
  expect(shipment.id).toMatch(/^shp_/)
  expect(shipment.rates.length).toBeGreaterThan(0)
  expect(shipment.rates[0]).toMatchObject({ carrier: expect.any(String), service: expect.any(String), rate: expect.any(String) })
})

test("buyShipment purchases the given rate and returns a tracking code + label", async () => {
  const client = new EasyPostClient({ apiKey: process.env.EASYPOST_API_KEY! })
  const shipment = await client.createShipment({ /* same fixture as above */ })
  const bought = await client.buyShipment(shipment.id, shipment.rates[0].id)
  expect(bought.trackingCode).toBeDefined()
  expect(bought.labelUrl).toMatch(/^https?:\/\//)
})

test("refundShipment submits a refund request for a bought shipment", async () => {
  const client = new EasyPostClient({ apiKey: process.env.EASYPOST_API_KEY! })
  const shipment = await client.createShipment({ /* same fixture */ })
  const bought = await client.buyShipment(shipment.id, shipment.rates[0].id)
  const refunded = await client.refundShipment(bought.id)
  expect(refunded.refundStatus).toBeDefined()
})

test("verifyWebhookSignature returns true for a correctly-signed payload and false for a tampered one", () => {
  const client = new EasyPostClient({ apiKey: "ek_test_unused_for_this_test" })
  const secret = "whsec_test"
  const rawBody = JSON.stringify({ description: "tracker.updated", result: { id: "trk_1" } })
  const validSignature = /* compute the real EasyPost HMAC scheme found in Step 2 over rawBody with secret */
  expect(client.verifyWebhookSignature(rawBody, validSignature, secret)).toBe(true)
  expect(client.verifyWebhookSignature(rawBody + "tampered", validSignature, secret)).toBe(false)
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-client.spec.ts`
Expected: FAIL — module not found (`EasyPostClient` doesn't exist yet).

- [ ] **Step 5: Implement `EasyPostClient`**

Implement exactly the methods and shapes confirmed in Step 2. `verifyWebhookSignature` computes EasyPost's documented HMAC scheme (confirm the exact algorithm/header name in Step 2 — EasyPost signs webhooks with HMAC-SHA256 over the raw request body using the webhook secret, but confirm this against the SDK/docs rather than trusting this plan's recollection) and does a constant-time comparison against the provided signature, not a plain `===` (same class of concern this codebase already takes seriously for comparing secrets).

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-client.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost
git commit -m "feat(fulfillment-easypost): scaffold package and EasyPost API client"
```

---

## Task 2: Carrier→service map and `getFulfillmentOptions()`

**Files:**
- Create: `packages/modules/providers/fulfillment-easypost/src/core/carrier-services.ts`
- Create: `packages/modules/providers/fulfillment-easypost/src/services/easypost-fulfillment.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/services/__tests__/easypost-fulfillment.spec.ts`

**Interfaces:**
- Consumes: `EasyPostClient` from Task 1.
- Produces: `CARRIER_SERVICE_MAP: Record<string, { code: string; name: string }[]>` keyed by EasyPost's carrier-account `type` string (confirmed against the real response in Step 1 below) — e.g. `{ UspsAccount: [{ code: "First", name: "USPS First Class" }, { code: "Priority", name: "USPS Priority" }, { code: "Express", name: "USPS Express" }], UpsAccount: [{ code: "Ground", name: "UPS Ground" }, { code: "2ndDayAir", name: "UPS 2nd Day Air" }, { code: "NextDayAir", name: "UPS Next Day Air" }] }` — confirm these exact service code strings against EasyPost's current API docs before finalizing; don't ship this plan's example values unverified.
- Produces: `EasyPostFulfillmentService` class (constructor takes `{ logger }` deps and `{ apiKey }` options, matching the `AbstractFulfillmentProviderService` constructor convention shown in its own doc comment), `static identifier = "easypost"`, with `getFulfillmentOptions(): Promise<FulfillmentOption[]>` implemented. Each returned option's `id` is `"${carrierType}:${serviceCode}"` (e.g. `"UspsAccount:Priority"`) and carries `{ name, carrierType, serviceCode }` so later tasks can parse it back out without a second lookup.

- [ ] **Step 1: Confirm the real carrier-account response shape against the test-mode account**

Write a throwaway script (or a temporary `console.log` in a test you delete before committing) that calls `EasyPostClient.listCarrierAccounts()` against the real test-mode API key and logs the raw response. Confirm: what field actually identifies the carrier (`type`? a separate `readable` string? something else?), and whether the test account's default carrier(s) match what this task assumes. Update `CARRIER_SERVICE_MAP`'s keys to match what you actually see, not this plan's guess.

- [ ] **Step 2: Write the failing tests**

```ts
test("getFulfillmentOptions returns one option per enabled carrier's known services", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const options = await service.getFulfillmentOptions()
  expect(options.length).toBeGreaterThan(0)
  // Every option's id must be parseable back into a carrier+service this
  // provider actually knows about -- not an arbitrary opaque string.
  for (const option of options) {
    expect(option.id).toMatch(/^\w+:\w+$/)
  }
})

test("getFulfillmentOptions returns an empty list, not an error, when the account has no carrier accounts", async () => {
  const fakeClient = { listCarrierAccounts: async () => [] } as unknown as EasyPostClient
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: "unused" })
  // inject the fake client -- see Step 3's note on making the client swappable for this one test
  const options = await service.getFulfillmentOptions()
  expect(options).toEqual([])
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `EasyPostFulfillmentService` (constructor + `getFulfillmentOptions`)**

Constructor builds an `EasyPostClient` from `options.apiKey` and stores it on a protected field (name it so the no-carrier-accounts test can substitute a fake — e.g. accept an optional injected client in the constructor's options for testing, following whatever pattern reads cleanest once you've read `payment-stripe`'s own constructor for precedent on handling test-time substitution). `getFulfillmentOptions()` calls `listCarrierAccounts()`, maps each account's carrier-type to `CARRIER_SERVICE_MAP`'s entries (skipping any carrier type not in the map, logging a warning rather than throwing — an account with a carrier this provider doesn't yet model is an expected, non-fatal case), and flattens into one `FulfillmentOption` per carrier+service pair.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/core/carrier-services.ts packages/modules/providers/fulfillment-easypost/src/services
git commit -m "feat(fulfillment-easypost): map enabled carriers to selectable fulfillment options"
```

---

## Task 3: Parcel builder, `canCalculate`, `validateOption`, `calculatePrice`

**Files:**
- Create: `packages/modules/providers/fulfillment-easypost/src/core/parcel.ts`
- Modify: `packages/modules/providers/fulfillment-easypost/src/services/easypost-fulfillment.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/core/__tests__/parcel.spec.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/services/__tests__/easypost-fulfillment.spec.ts` (add cases)

**Interfaces:**
- Consumes: `EasyPostClient.createShipment` from Task 1; `EasyPostFulfillmentService` from Task 2; Medusa's real `CalculateShippingOptionPriceContext` type (`CartPropsForFulfillment & { from_location?: StockLocationDTO }`, confirmed against `packages/core/types/src/fulfillment/mutations/shipping-option.ts` and `packages/core/types/src/fulfillment/common/cart.ts` — `context.items[].variant.{weight,length,height,width}`, `context.shipping_address`, `context.from_location`).
- Produces: `buildParcel(items: CartPropsForFulfillment["items"], defaults: { weight: number; length: number; width: number; height: number }): { weight: number; length: number; width: number; height: number }` — a pure function, no API calls. Produces: `EasyPostFulfillmentService.canCalculate()`, `.validateOption(data)`, `.calculatePrice(optionData, data, context)`.

- [ ] **Step 1: Write the failing tests for `buildParcel`**

```ts
test("buildParcel sums real per-item dimensions and weight across quantity", () => {
  const items = [
    { quantity: 2, variant: { weight: 8, length: 10, width: 6, height: 2 } },
    { quantity: 1, variant: { weight: 4, length: 5, width: 5, height: 5 } },
  ] as CartPropsForFulfillment["items"]
  const parcel = buildParcel(items, { weight: 16, length: 10, width: 8, height: 4 })
  // Weight sums per quantity (2*8 + 1*4 = 20); dims take the largest single
  // item's footprint rather than naively summing (summing length/width/height
  // across unrelated items would produce an absurd box) -- the exact
  // packing heuristic is this task's own choice, document whichever you
  // pick in a comment since there's no single "correct" bin-packing answer.
  expect(parcel.weight).toBe(20)
})

test("buildParcel falls back to the configured default for any item missing weight/dimensions", () => {
  const items = [{ quantity: 1, variant: { weight: null, length: null, width: null, height: null } }] as any
  const parcel = buildParcel(items, { weight: 16, length: 10, width: 8, height: 4 })
  expect(parcel).toEqual({ weight: 16, length: 10, width: 8, height: 4 })
})

test("buildParcel falls back per-field when only some dimensions are missing on an item", () => {
  const items = [{ quantity: 1, variant: { weight: 8, length: null, width: 6, height: 2 } }] as any
  const parcel = buildParcel(items, { weight: 16, length: 10, width: 8, height: 4 })
  expect(parcel.weight).toBe(8)
  expect(parcel.length).toBe(10) // fallback, since this one field was null
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @dtc/fulfillment-easypost test parcel.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildParcel`**

Pick and document a simple, defensible packing heuristic (e.g. sum weight across all items × quantity; for dimensions, take the single largest item's length/width/height rather than summing them, since summing would produce a nonsensical box size for multi-item orders). This is a deliberately simple v1 — the spec's non-goals don't mention real bin-packing, and nothing downstream needs more precision than "a parcel EasyPost will quote a rate for."

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @dtc/fulfillment-easypost test parcel.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `canCalculate`/`validateOption`/`calculatePrice`**

```ts
test("canCalculate returns true for any option this provider produced", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  expect(await service.canCalculate({ data: { id: "UspsAccount:Priority" } } as any)).toBe(true)
})

test("calculatePrice returns a real EasyPost rate for the cart's real destination and parcel", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const context = {
    id: "cart_test",
    shipping_address: { address_1: "417 montgomery st", city: "San Francisco", province: "CA", postal_code: "94104", country_code: "us" },
    from_location: { address: { address_1: "118 2nd street", city: "San Francisco", province: "CA", postal_code: "94105", country_code: "us" } },
    items: [{ quantity: 1, variant: { weight: 16, length: 10, width: 8, height: 4 } }],
  } as unknown as CalculateShippingOptionPriceContext
  const price = await service.calculatePrice({ carrierType: "UspsAccount", serviceCode: "Priority" }, {}, context)
  expect(price.calculated_amount).toBeGreaterThan(0)
})

test("calculatePrice throws a clear error when EasyPost can't quote this carrier+service for the destination", async () => {
  // Use a destination/carrier+service combination you've confirmed EasyPost's
  // test mode genuinely can't quote (check Step 1's carrier-account
  // discovery for one, e.g. a carrier not enabled on the test account) --
  // don't fabricate one you haven't verified actually fails this way.
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  await expect(
    service.calculatePrice({ carrierType: "NotEnabledAccount", serviceCode: "Fake" }, {}, validContextFixture)
  ).rejects.toThrow()
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: FAIL — methods not implemented.

- [ ] **Step 7: Implement `canCalculate`, `validateOption`, `calculatePrice`**

**A real asymmetry to get right, not guess at:** `canCalculate(data: CreateShippingOptionDTO)`'s `data` param is confirmed (via `packages/core/types/src/fulfillment/mutations/shipping-option.ts`) to be the *whole* shipping-option-creation DTO, which has its own nested `data?: Record<string, unknown>` holding what `getFulfillmentOptions()` returned for the admin's chosen option — so this method checks `data.data?.id`, not `data.id`. `validateOption(data)` and `calculatePrice(optionData, data, context)`, by contrast, receive that nested data *directly* as their own first argument (confirmed via the abstract class's own doc comments for each) — so those check `data.id`/`optionData.id` with no extra nesting. Three methods, three different "what does `data` mean here" answers — write each one to match its own real parameter shape, not a copy-pasted assumption from the method next to it.

`canCalculate(data)` returns `true` whenever `data.data?.id` matches this provider's `"carrierType:serviceCode"` id shape (no API call needed). `validateOption(data)` does the same shape check directly on `data.id` (no extra nesting — see note above). `calculatePrice(optionData, data, context)` builds the parcel via `buildParcel(context.items, this.options_.defaultParcel)`, calls `EasyPostClient.createShipment` with `context.shipping_address` and `context.from_location` mapped into EasyPost's address shape (confirmed field names from Task 1's Step 2) and the built parcel, finds the rate in the response matching `optionData`'s carrier+service, and returns `{ calculated_amount: Number(rate.rate), is_calculated_price_tax_inclusive: false }`. If no matching rate comes back, throw a descriptive error (per this task's Review Focus item) — Medusa's own checkout flow is responsible for dropping an option whose price calculation fails, not this provider.

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts parcel.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/core/parcel.ts packages/modules/providers/fulfillment-easypost/src/services
git commit -m "feat(fulfillment-easypost): build parcels from real cart data and price via live EasyPost rates"
```

---

## Task 4: `validateFulfillmentData` — persist the checkout-time rate for later purchase

**Files:**
- Modify: `packages/modules/providers/fulfillment-easypost/src/services/easypost-fulfillment.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/services/__tests__/easypost-fulfillment.spec.ts` (add cases)

**Interfaces:**
- Consumes: `EasyPostClient.createShipment` from Task 1; `buildParcel` from Task 3.
- Produces: `EasyPostFulfillmentService.validateFulfillmentData(optionData, data, context)` returning `{ ...data, easypost_shipment_id: string, easypost_rate_id: string, easypost_carrier: string, easypost_service: string }` — this exact object shape is what Task 5's `createFulfillment` consumes as its `data` parameter.

- [ ] **Step 1: Write the failing tests**

```ts
test("validateFulfillmentData persists a real shipment id and matching rate id for later purchase", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const result = await service.validateFulfillmentData(
    { carrierType: "UspsAccount", serviceCode: "Priority" },
    {},
    validContextFixture
  )
  expect(result.easypost_shipment_id).toMatch(/^shp_/)
  expect(result.easypost_rate_id).toBeDefined()
  expect(result.easypost_carrier).toBe("USPS") // or whatever EasyPost's own `carrier` field value actually is -- confirm against Task 1 Step 2's findings, don't assume this exact string
})

test("validateFulfillmentData throws when EasyPost can't quote this carrier+service for the destination (Review Focus)", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  await expect(
    service.validateFulfillmentData({ carrierType: "NotEnabledAccount", serviceCode: "Fake" }, {}, validContextFixture)
  ).rejects.toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: FAIL — method not implemented.

- [ ] **Step 3: Implement `validateFulfillmentData`**

Reuses the same shipment-creation + rate-matching logic as `calculatePrice` (extract a shared private helper between the two rather than duplicating the EasyPost call and rate-matching code — this is the one place in this task where DRY-ing two call sites genuinely helps, unlike this codebase's usual per-file-duplication convention for small independent pieces of logic). Returns the merged `data` object with the shipment/rate ids persisted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/services
git commit -m "feat(fulfillment-easypost): persist the checkout-time rate for exact-price fulfillment"
```

---

## Task 5: `createFulfillment`, `createReturnFulfillment`, `cancelFulfillment`

**Files:**
- Modify: `packages/modules/providers/fulfillment-easypost/src/services/easypost-fulfillment.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/services/__tests__/easypost-fulfillment.spec.ts` (add cases)

**Interfaces:**
- Consumes: `EasyPostClient.buyShipment`/`refundShipment`/`createShipment` from Task 1; the `data` shape from Task 4 (`easypost_shipment_id`, `easypost_rate_id`).
- Produces: `createFulfillment(data, items, order, fulfillment)` returning `{ data: { ...data, easypost_tracking_code, easypost_label_url, easypost_tracker_id }, labels: [{ tracking_number, tracking_url, label_url }] }` (this exact shape is `CreateFulfillmentResult`, confirmed against `packages/core/types/src/fulfillment/provider.ts`) — critically, `data.easypost_tracking_code` is what Task 8's webhook route looks fulfillments up by, so the key name must match exactly. Produces: `createReturnFulfillment(fulfillment)` with the same return shape. Produces: `cancelFulfillment(data)` returning the refund submission result.

- [ ] **Step 1: Write the failing tests**

```ts
test("createFulfillment buys the exact persisted rate and returns a tracking code + label", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const validated = await service.validateFulfillmentData({ carrierType: "UspsAccount", serviceCode: "Priority" }, {}, validContextFixture)
  const result = await service.createFulfillment(validated, [], undefined, {} as any)
  expect(result.data.easypost_tracking_code).toBeDefined()
  expect(result.labels[0].tracking_number).toBe(result.data.easypost_tracking_code)
  expect(result.labels[0].label_url).toMatch(/^https?:\/\//)
})

test("createFulfillment throws a clear error for an expired or already-bought rate (Review Focus)", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const validated = await service.validateFulfillmentData({ carrierType: "UspsAccount", serviceCode: "Priority" }, {}, validContextFixture)
  await service.createFulfillment(validated, [], undefined, {} as any) // first buy succeeds
  await expect(service.createFulfillment(validated, [], undefined, {} as any)).rejects.toThrow() // second buy of the same shipment/rate must not silently "succeed" again
})

test("createReturnFulfillment buys a label with addresses reversed", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const result = await service.createReturnFulfillment(returnFulfillmentFixture) // fixture's to/from addresses are the reverse of validContextFixture's
  expect(result.data.easypost_tracking_code).toBeDefined()
})

test("cancelFulfillment submits a refund request for a bought shipment", async () => {
  const service = new EasyPostFulfillmentService({ logger: fakeLogger }, { apiKey: process.env.EASYPOST_API_KEY! })
  const validated = await service.validateFulfillmentData({ carrierType: "UspsAccount", serviceCode: "Priority" }, {}, validContextFixture)
  const created = await service.createFulfillment(validated, [], undefined, {} as any)
  const cancelled = await service.cancelFulfillment(created.data)
  expect(cancelled).toBeDefined() // exact assertion depends on what refundShipment actually returns -- confirm against Task 1
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: FAIL — methods not implemented.

- [ ] **Step 3: Implement `createFulfillment`, `createReturnFulfillment`, `cancelFulfillment`**

`createFulfillment` calls `EasyPostClient.buyShipment(data.easypost_shipment_id, data.easypost_rate_id)` and maps the response into the pinned return shape. For the "already bought" case: confirm what the real EasyPost test-mode API actually does when you call buy twice on the same shipment (error? idempotent success? a different rate?) in Step 1's real-API test run, and implement to match reality rather than assuming — this is exactly the kind of external behavior this plan can't specify from memory. `createReturnFulfillment` builds a parcel/shipment with to/from swapped and buys the cheapest (or a configured-preference) rate, since a return fulfillment context doesn't carry a pre-selected carrier+service the way an outbound checkout option does — check `fulfillment`'s actual shape for whether it carries the original shipping option's data at all before deciding this; if it does, reuse the same carrier+service as the outbound shipment instead of picking cheapest. `cancelFulfillment` calls `EasyPostClient.refundShipment(data.easypost_shipment_id)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @dtc/fulfillment-easypost test easypost-fulfillment.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/services
git commit -m "feat(fulfillment-easypost): buy labels, create returns, and cancel/refund fulfillments"
```

---

## Task 6: Module registration and changeset

**Files:**
- Create: `packages/modules/providers/fulfillment-easypost/src/index.ts`
- Create: `.changeset/add-fulfillment-easypost.md`

**Interfaces:**
- Consumes: `EasyPostFulfillmentService` from Tasks 2-5.
- Produces: the package's default export — a Medusa module definition registering `EasyPostFulfillmentService` as a fulfillment provider, following `fulfillment-manual`'s/`payment-stripe`'s own `src/index.ts` shape exactly (read both before writing this one; don't improvise a new module-definition shape).

- [ ] **Step 1: Read `fulfillment-manual`'s and `payment-stripe`'s `src/index.ts`**

Confirm the exact `ModuleProvider`/`Module` helper call shape each uses to register their service, and match it precisely — this is a case where copying the established pattern exactly is correct, not something to improve on.

- [ ] **Step 2: Implement `src/index.ts`**

Register `EasyPostFulfillmentService` the same way, under the identifier `"easypost"` (matching `static identifier = "easypost"` from Task 2).

- [ ] **Step 3: Verify the package builds**

Run: `yarn workspace @dtc/fulfillment-easypost build`
Expected: succeeds with no type errors.

- [ ] **Step 4: Write the changeset**

```md
---
"@dtc/fulfillment-easypost": patch
---

feat(fulfillment-easypost): add EasyPost-backed fulfillment provider
```

- [ ] **Step 5: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/index.ts .changeset/add-fulfillment-easypost.md
git commit -m "feat(fulfillment-easypost): register the module and add a changeset"
```

---

## Task 7: Wire the provider into `test-project`

**Files:**
- Modify: `test-project/apps/backend/medusa-config.ts`
- Modify: `test-project/apps/backend/.env.template`
- Modify: `test-project/apps/backend/.env` (gitignored — not committed; see Step 2)

**Interfaces:**
- Consumes: `@dtc/fulfillment-easypost`'s module export from Task 6.
- Produces: nothing new for later tasks to consume — Task 8's webhook route reads its own env vars directly, independent of this task's config wiring.

- [ ] **Step 1: Add `@dtc/fulfillment-easypost` as a workspace dependency of `test-project`'s backend**

Add it to `test-project/apps/backend/package.json`'s dependencies (following whatever workspace-linking convention `test-project` already uses for StoreCentral packages — check `CONTRIBUTING.md`'s linking instructions, the same ones Task 1 of the Seller Hub plan already followed for this exact test project, before assuming `yarn link`/a `workspace:*` range/a different mechanism). Run install.

- [ ] **Step 2: Add the `medusa-config.ts` module registration**

Add a `modules` array entry (there currently is none at all in this file — confirmed by reading it) registering `@dtc/fulfillment-easypost` as a fulfillment provider, following Medusa's documented `modules: [{ resolve: "@medusajs/fulfillment", options: { providers: [{ resolve: "@dtc/fulfillment-easypost", id: "easypost", options: { apiKey: process.env.EASYPOST_API_KEY, webhookSecret: process.env.EASYPOST_WEBHOOK_SECRET, defaultParcel: { weight: Number(process.env.EASYPOST_DEFAULT_PARCEL_WEIGHT ?? 16), length: Number(process.env.EASYPOST_DEFAULT_PARCEL_LENGTH ?? 10), width: Number(process.env.EASYPOST_DEFAULT_PARCEL_WIDTH ?? 8), height: Number(process.env.EASYPOST_DEFAULT_PARCEL_HEIGHT ?? 4) } } }] } }]` shape for registering a *provider* (not a whole custom module) — confirm this exact registration shape against Medusa's real documented config format for "add a provider to an existing module" before writing it; don't invent the config schema.

- [ ] **Step 3: Add the new env vars to `.env.template`, and real values to the gitignored `.env`**

`EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET`, `EASYPOST_DEFAULT_PARCEL_WEIGHT`/`_LENGTH`/`_WIDTH`/`_HEIGHT`. The real `EASYPOST_API_KEY` value is the test-mode key already provided earlier in this project's planning conversation — put it in `.env` only, never `.env.template`, matching every other secret in this repo.

- [ ] **Step 4: Start the real backend and confirm it boots with the new provider registered**

Run: `yarn dev` in `apps/backend`, confirm no startup errors, then check the admin API lists the new provider: `GET /admin/fulfillment-providers` (or whatever the real route is — confirm it exists before relying on it) should include `"easypost"` or `"fp_easypost_easypost"` depending on Medusa's actual id-prefixing convention (confirmed in `AbstractFulfillmentProviderService`'s own doc comment: `fp_{identifier}_{id}`).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/medusa-config.ts apps/backend/.env.template apps/backend/package.json
git commit -m "feat(backend): register the EasyPost fulfillment provider"
```

(Note: `apps/backend/.env` is gitignored and intentionally not included in this commit.)

---

## Task 8: EasyPost tracking webhook route

**Files:**
- Create: `test-project/apps/backend/src/api/webhooks/easypost/route.ts`
- Test: `test-project/apps/backend/src/api/webhooks/easypost/__tests__/route.spec.ts` (or wherever this app's existing API route tests, if any, actually live — check for precedent before picking a location)

**Interfaces:**
- Consumes: the `easypost_tracking_code` key on a fulfillment's `data` property, written by Task 5's `createFulfillment`; `createShipmentWorkflow`/`markFulfillmentAsDeliveredWorkflow` from `@medusajs/core-flows` (confirmed to exist in `packages/core/core-flows/src/fulfillment/workflows/create-shipment.ts` and `mark-fulfillment-as-delivered.ts`); `EASYPOST_WEBHOOK_SECRET` from Task 7's config.
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Confirm the fulfillment lookup mechanism against the real local backend**

Before writing the route, confirm whether Medusa's Query Graph (`req.scope.resolve(ContainerRegistrationKeys.QUERY)`, per this repo's own documented pattern in `CLAUDE.md`'s "Common Patterns" section) can filter fulfillments by a nested `data` field — e.g. `query.graph({ entity: "fulfillment", fields: ["id", "order.id"], filters: { data: { easypost_tracking_code: "<a real one you created via Task 5's test>" } } })`. Try this against the real local backend with a fulfillment you've actually created (via Task 5's own test, or a one-off script). If it works, that's the lookup mechanism. If it does not (Medusa's `FilterableFulfillmentProps` type, confirmed in `packages/core/types/src/fulfillment/common/fulfillment.ts`, does not list `data` as a filterable field, so this may not be supported) — fall back to `query.graph({ entity: "fulfillment", fields: ["id", "data", "order.id"], filters: { created_at: { $gte: <a reasonable recency window, e.g. 30 days ago> } } })` and scan the returned fulfillments' `data.easypost_tracking_code` client-side for a match. Document which path you actually used, and why, at the top of the route file.

- [ ] **Step 2: Write the failing tests**

```ts
test("rejects a webhook with an invalid signature before touching any data", async () => {
  const res = await postWebhook({ body: validPayload, signature: "wrong" })
  expect(res.status).toBe(401)
})

test("returns 200 and does nothing harmful for an unknown tracking code", async () => {
  const res = await postWebhook({ body: { description: "tracker.updated", result: { tracking_code: "UNKNOWN_123", status: "in_transit" } }, signature: validSignatureFor(/* that body */) })
  expect(res.status).toBe(200)
})

test("returns 400, not a crash, for a malformed body", async () => {
  const res = await postWebhook({ rawBody: "not json", signature: validSignatureForRaw("not json") })
  expect(res.status).toBe(400)
})

test("updates the real fulfillment's status when a valid webhook matches a known tracking code (Review Focus: core happy path)", async () => {
  // Use Task 5's own createFulfillment against the real backend to produce
  // a real fulfillment with a real easypost_tracking_code first, then post
  // a webhook claiming that tracking code is now "delivered", then verify
  // (via the admin API, same pattern as Seller Hub's own order-import
  // tests) that the real fulfillment's delivered_at is now set.
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: whatever this app's test command is for `apps/backend` (confirm it — likely Jest per `CLAUDE.md`, but this app may not have its own route-test harness set up yet; if not, set up the minimal Jest config needed, following `CLAUDE.md`'s stated backend testing conventions rather than inventing a new one)
Expected: FAIL — route doesn't exist / returns 404.

- [ ] **Step 4: Implement the webhook route**

Verify the signature against `req.rawBody` using `EasyPostClient.verifyWebhookSignature` (reuse Task 1's method — this app can import `@dtc/fulfillment-easypost`'s client directly, it's already a dependency per Task 7) and `EASYPOST_WEBHOOK_SECRET`. Parse `{ description, result: { tracking_code, status } }`, look up the fulfillment via Step 1's confirmed mechanism, and call `createShipmentWorkflow` for in-transit-family statuses or `markFulfillmentAsDeliveredWorkflow` for `delivered` (confirm both workflows' real input shapes by reading their source, found in Step 1's file paths, before calling them — don't guess their parameters). Return `200` on any outcome except a bad signature (`401`) or an unparseable body (`400`), per this task's Review Focus items.

- [ ] **Step 5: Run tests to verify they pass**

Run: same test command as Step 3
Expected: PASS

- [ ] **Step 6: Manually verify against the live running backend**

With the real backend running (Task 7 Step 4), use the demo fulfillment created during this task's own test run (or create a fresh one) and send a real, correctly-signed webhook POST via `curl`/`fetch` against the running `yarn dev` instance, confirming in the admin UI or via a direct API check that the fulfillment's status actually updated. This is the same kind of manual smoke step Seller Hub's own webhook task (Task 9) used for its equivalent live-wiring check — don't skip it just because the automated tests passed.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/api/webhooks
git commit -m "feat(backend): add EasyPost tracking webhook route"
```
