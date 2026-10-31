# Bulk Order Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the admin "Ready to Ship" table into an interactive, Veeqo-style bulk fulfillment tool with live EasyPost multi-carrier rate shopping, editable package/ship-from per row, sales-channel SLA tracking, and consolidated label printing.

**Architecture:** A new EasyPost-specific rate-quote/buy/label-batch surface is added to the existing `@dtc/fulfillment-easypost` provider and reached directly from a new admin API route and from the (forked) `bulk-fulfill-orders` core-flows step via the fulfillment module's own provider-registration container key (`fp_easypost`) — bypassing the generic `AbstractFulfillmentProviderService` interface, which has no "quote without buying" or "buy an arbitrary rate" operations. `createOrderFulfillmentWorkflow` gains one new optional input, `provider_data_override`, so a freshly-bought EasyPost shipment can be injected directly instead of being read from `shipping_methods[0].data`. The admin dashboard's Ready to Ship table gets five new/upgraded interactive cells, all operating on ephemeral per-row local state until "Fulfill" is clicked.

**Tech Stack:** Medusa (TypeScript workflows-sdk, Zod validators), React + `@tanstack/react-table`/`@tanstack/react-query`, `@easypost/api` v8.9.0, Jest (provider/core-flows unit + apps/backend integration tests), existing dashboard test conventions (`*.spec.tsx`).

**Spec:** `docs/superpowers/specs/2026-11-01-bulk-order-fulfillment-design.md`

## Global Constraints

- Only USPS and FedExDefault carriers exist in `CARRIER_SERVICE_MAP` (`packages/modules/providers/fulfillment-easypost/src/core/carrier-services.ts`) — no UPS/DHL. Every new rate-related code path filters through this exact map, unchanged.
- The EasyPost fulfillment provider's registered id is `"easypost"`; the fulfillment module resolves provider service instances from the DI container under the key `` `fp_${providerId}` `` (confirmed in `packages/modules/fulfillment/src/services/fulfillment-provider.ts:63`) — so the provider instance is reached via `container.resolve("fp_easypost")` / `req.scope.resolve("fp_easypost")` anywhere outside the fulfillment module itself.
- `Batch.buy()` (EasyPost) is never used — it is asynchronous/webhook-driven. Only `Batch.create` + `Batch.generateLabel` are used, against shipments already individually purchased via `Shipment.buy`.
- Package presets are a hardcoded list of EasyPost's documented `predefined_package` string codes (grouped by carrier) — there is no EasyPost endpoint that lists these at runtime.
- Ship From default is a single store-wide setting (`Store.metadata.default_ship_from_location_id`), not per-sales-channel.
- Ship-by SLA is per-sales-channel (`SalesChannel.metadata.handling_hours`, a number of hours), not store-wide and not read from any existing per-order field.
- A row's in-progress Package/Ship From/Rate selections are ephemeral local component state — never persisted, never read back on reload.
- No semicolons, double quotes, 2-space indent, kebab-case filenames (per `AGENTS.md`) — apply to every new file in this plan.

## Review Focus

- **Incomplete address at quote time** (an order's shipping address or the chosen stock location's address is missing a required field): the new `carrier-rates` route must return a clear 400-type error, not a 500 from an unhandled EasyPost rejection. Owned by Task 6.
- **Buy succeeds, fulfillment creation fails** (a real EasyPost label gets bought, then `createOrderFulfillmentWorkflow` throws): that order's failure entry must carry the bought shipment id, not just a bare error string, or the purchase is silently orphaned. Owned by Task 4.
- **One order's failure doesn't abort the batch**: a `buyRate` or `createOrderFulfillmentWorkflow` failure for one order in a multi-order bulk-fulfill call must not prevent the remaining orders in the same request from succeeding. Owned by Task 4.
- **A sales channel with no configured SLA** (`metadata.handling_hours` never set): the Ship Date/Ship Time cell must render a defined "no SLA set" state, not `Invalid Date`, `NaN`, or a thrown render error. Owned by Task 12.
- **Custom package with missing/zero weight**: the Package popover's "Custom" option must block confirming with an inline validation message when weight is empty or `<= 0`, rather than sending an unratable parcel to EasyPost and surfacing an opaque API error. Owned by Task 9.

---

### Task 1: EasyPostClient — predefined package input + Batch label consolidation

**Files:**
- Modify: `packages/modules/providers/fulfillment-easypost/src/core/easypost-client.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/core/__tests__/easypost-client.spec.ts`

**Interfaces:**
- Produces: `EasyPostParcelInput` gains `predefinedPackage?: string`. New methods on `EasyPostClient`: `createBatch(shipmentIds: string[]): Promise<{ id: string }>` and `generateBatchLabel(batchId: string, format: "pdf" | "zpl" | "epl2"): Promise<{ labelUrl?: string }>`.

- [ ] **Step 1: Write failing tests for the new client methods**

```ts
it("passes predefinedPackage through to EasyPost as predefined_package", async () => {
  const fakeShipmentCreate = jest.fn().mockResolvedValue({ id: "shp_1", rates: [] })
  // construct EasyPostClient with a stubbed underlying SDK client (follow
  // this file's existing test pattern for stubbing `this.client.Shipment`)
  await client.createShipment({
    toAddress, fromAddress,
    parcel: { weight: 16, predefinedPackage: "SmallFlatRateBox" },
  })
  expect(fakeShipmentCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      parcel: expect.objectContaining({ predefined_package: "SmallFlatRateBox" }),
    })
  )
})

it("createBatch wraps shipment ids as { shipments: [{ id }] } and returns the batch id", async () => {
  const fakeBatchCreate = jest.fn().mockResolvedValue({ id: "batch_1" })
  const result = await client.createBatch(["shp_1", "shp_2"])
  expect(fakeBatchCreate).toHaveBeenCalledWith({
    shipments: [{ id: "shp_1" }, { id: "shp_2" }],
  })
  expect(result).toEqual({ id: "batch_1" })
})

it("generateBatchLabel returns the consolidated label url", async () => {
  const fakeGenerateLabel = jest.fn().mockResolvedValue({ label_url: "https://easypost.test/batch.pdf" })
  const result = await client.generateBatchLabel("batch_1", "pdf")
  expect(fakeGenerateLabel).toHaveBeenCalledWith("batch_1", "pdf")
  expect(result).toEqual({ labelUrl: "https://easypost.test/batch.pdf" })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/modules/providers/fulfillment-easypost && yarn jest easypost-client -t "predefinedPackage|createBatch|generateBatchLabel"`
Expected: FAIL (`predefinedPackage` unknown field / `createBatch`/`generateBatchLabel` not a function)

- [ ] **Step 3: Implement the changes in `easypost-client.ts`**

Add `predefinedPackage?: string` to `EasyPostParcelInput` (line ~129-134). In `toEasyPostParcel` (line ~350-357), add `predefined_package: parcel.predefinedPackage` to the returned object. Add `createBatch(shipmentIds: string[]): Promise<{ id: string }>` calling `this.client.Batch.create({ shipments: shipmentIds.map((id) => ({ id })) })` and returning `{ id: batch.id }`. Add `generateBatchLabel(batchId: string, format: "pdf" | "zpl" | "epl2"): Promise<{ labelUrl?: string }>` calling `this.client.Batch.generateLabel(batchId, format)` and returning `{ labelUrl: batch.label_url ?? undefined }`. Follow this file's existing doc-comment convention (one block above the class explaining what was confirmed against the real/typed SDK) for the `Batch` resource, same as the existing blocks for `Shipment`/`CarrierAccount`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd packages/modules/providers/fulfillment-easypost && yarn jest easypost-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/core/easypost-client.ts packages/modules/providers/fulfillment-easypost/src/core/__tests__/easypost-client.spec.ts
git commit -m "feat(fulfillment-easypost): add predefined package input and batch label consolidation to EasyPostClient"
```

---

### Task 2: EasyPostFulfillmentService — quoteAllRates, buyRate, createLabelBatch

**Files:**
- Modify: `packages/modules/providers/fulfillment-easypost/src/services/easypost-fulfillment.ts`
- Test: `packages/modules/providers/fulfillment-easypost/src/services/__tests__/easypost-fulfillment.spec.ts`

**Interfaces:**
- Consumes: `EasyPostClient.createBatch`/`generateBatchLabel` (Task 1), existing `EasyPostClient.createShipment`/`buyShipment`, `CARRIER_SERVICE_MAP` (`../core/carrier-services`).
- Produces on `EasyPostFulfillmentService`:
  - `quoteAllRates(parcel: EasyPostParcelInput, fromAddress: EasyPostAddressInput, toAddress: EasyPostAddressInput): Promise<{ shipmentId: string; rates: { carrier: string; service: string; name: string; rateId: string; amount: string; currency: string }[] }>`
  - `buyRate(shipmentId: string, rateId: string): Promise<EasyPostShipment>`
  - `createLabelBatch(shipmentIds: string[], format: "pdf" | "zpl" | "epl2"): Promise<{ labelUrl?: string }>`

- [ ] **Step 1: Write failing tests**

```ts
it("quoteAllRates filters shipment rates through CARRIER_SERVICE_MAP and sorts cheapest first", async () => {
  // stub this.client_.createShipment to resolve a shipment whose `rates`
  // include: USPS/GroundAdvantage at "9.00", FedExDefault/FEDEX_GROUND at
  // "7.50", and an unmapped carrier "UPS"/"Ground" that must be dropped
  const result = await service.quoteAllRates(parcel, fromAddress, toAddress)
  expect(result.rates.map((r) => `${r.carrier}:${r.service}`)).toEqual([
    "FedExDefault:FEDEX_GROUND",
    "USPS:GroundAdvantage",
  ])
  expect(result.rates[0].amount).toBe("7.50")
  expect(result.shipmentId).toBe(shipment.id)
})

it("buyRate delegates to the client's buyShipment", async () => {
  const result = await service.buyRate("shp_1", "rate_1")
  expect(fakeClient.buyShipment).toHaveBeenCalledWith("shp_1", "rate_1")
})

it("createLabelBatch creates a batch from the given shipment ids and generates a PDF label", async () => {
  const result = await service.createLabelBatch(["shp_1", "shp_2"], "pdf")
  expect(fakeClient.createBatch).toHaveBeenCalledWith(["shp_1", "shp_2"])
  expect(fakeClient.generateBatchLabel).toHaveBeenCalledWith("batch_1", "pdf")
  expect(result.labelUrl).toBe("https://easypost.test/batch.pdf")
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/modules/providers/fulfillment-easypost && yarn jest easypost-fulfillment -t "quoteAllRates|buyRate|createLabelBatch"`
Expected: FAIL (methods not defined)

- [ ] **Step 3: Implement the three methods on `EasyPostFulfillmentService`**

`quoteAllRates`: calls `this.client_.createShipment({ toAddress, fromAddress, parcel })`, then loops `shipment.rates` exactly like `getFulfillmentOptions` (line ~130-159) — look up `CARRIER_SERVICE_MAP[rate.carrier]`, skip unmapped carriers/services — but instead of de-duplicating into fulfillment options, map each matched rate into `{ carrier, service, name: matchedService.name, rateId: rate.id, amount: rate.rate, currency: rate.currency }`, then sort ascending by `Number(amount)`. Return `{ shipmentId: shipment.id, rates }`.
`buyRate`: one line, `return this.client_.buyShipment(shipmentId, rateId)`.
`createLabelBatch`: `const batch = await this.client_.createBatch(shipmentIds); return this.client_.generateBatchLabel(batch.id, format)`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd packages/modules/providers/fulfillment-easypost && yarn jest easypost-fulfillment`
Expected: PASS

- [ ] **Step 5: Export `toEasyPostAddress` for reuse by the new admin route (Task 6)**

Change `function toEasyPostAddress(...)` (line ~1004) to `export function toEasyPostAddress(...)`. Add it to this package's public surface in `src/index.ts` (check the file; add an export line alongside however `EasyPostFulfillmentService` is already exported). No new test needed — this is a visibility change on code Task 6's own tests exercise through the public import.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/providers/fulfillment-easypost/src/services/easypost-fulfillment.ts packages/modules/providers/fulfillment-easypost/src/services/__tests__/easypost-fulfillment.spec.ts packages/modules/providers/fulfillment-easypost/src/index.ts
git commit -m "feat(fulfillment-easypost): add quoteAllRates, buyRate, and createLabelBatch to the provider service"
```

---

### Task 3: `createOrderFulfillmentWorkflow` — `provider_data_override` input

**Files:**
- Modify: `packages/core/core-flows/src/order/workflows/create-fulfillment.ts`
- Test: `packages/core/core-flows/src/order/workflows/__tests__/create-fulfillment.unit.spec.ts` (create if no `__tests__` dir exists alongside this file yet; follow this package's existing workflow-unit-test convention from a sibling workflow's own `__tests__` if one exists, otherwise a plain Jest file importing and invoking `prepareFulfillmentData` directly, since it's an exported-for-test-or-local function — if it is not currently exported, add `export` to its declaration at line 149 for testability, matching this file's existing exported-helper pattern for `prepareRegisterOrderFulfillmentData`)

**Interfaces:**
- Produces: `CreateOrderFulfillmentWorkflowInput` (line 377-378) gains `& { provider_data_override?: Record<string, unknown> }`. `prepareFulfillmentData`'s returned `input.data` becomes `input.provider_data_override ?? shippingMethod.data` instead of unconditionally `shippingMethod.data`.

- [ ] **Step 1: Write failing tests for `prepareFulfillmentData`**

```ts
it("uses provider_data_override for the fulfillment data when present", () => {
  const result = prepareFulfillmentData({
    order, input: { ...baseInput, provider_data_override: { easypost_shipment_id: "shp_fresh" } },
    shippingOption, shippingMethod: { data: { easypost_shipment_id: "shp_checkout" } },
    reservations: [],
  })
  expect(result.input.data).toEqual({ easypost_shipment_id: "shp_fresh" })
})

it("falls back to the shipping method's data when no override is given (regression)", () => {
  const result = prepareFulfillmentData({
    order, input: baseInput, shippingOption,
    shippingMethod: { data: { easypost_shipment_id: "shp_checkout" } },
    reservations: [],
  })
  expect(result.input.data).toEqual({ easypost_shipment_id: "shp_checkout" })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/core/core-flows && yarn jest create-fulfillment -t "provider_data_override|regression"`
Expected: FAIL

- [ ] **Step 3: Implement the type and the one-line change**

Add `export function prepareFulfillmentData(...)` if not already exported (add `export` at line 149). Add `provider_data_override?: Record<string, unknown>` to `CreateOrderFulfillmentWorkflowInput` (line 377-378 intersection). Change line 270 from `data: shippingMethod.data,` to `data: input.provider_data_override ?? shippingMethod.data,`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd packages/core/core-flows && yarn jest create-fulfillment`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/core-flows/src/order/workflows/create-fulfillment.ts packages/core/core-flows/src/order/workflows/__tests__/create-fulfillment.unit.spec.ts
git commit -m "feat(core-flows): add provider_data_override input to createOrderFulfillmentWorkflow"
```

---

### Task 4: `bulkFulfillOrdersStep`/`bulkFulfillOrdersWorkflow` — buy-then-fulfill per order, consolidated label batch

**Files:**
- Modify: `packages/core/core-flows/src/order/steps/bulk-fulfill-orders.ts`
- Modify: `packages/core/core-flows/src/order/workflows/bulk-fulfill-orders.ts` (doc comment only — re-exports the step's input type verbatim, no type changes needed there)
- Test: `packages/core/core-flows/src/order/steps/__tests__/bulk-fulfill-orders.unit.spec.ts` (create if it doesn't already exist, following whatever sibling step test in this `__tests__` directory already does for mocking `container.resolve`/`createOrderFulfillmentWorkflow`)

**Interfaces:**
- Consumes: `EasyPostFulfillmentService.buyRate`/`createLabelBatch` (Task 2), resolved via `container.resolve("fp_easypost")`; `createOrderFulfillmentWorkflow` with `provider_data_override` (Task 3).
- Produces:
  - `BulkFulfillOrdersStepInput = { fulfillments: { order_id: string; location_id?: string; shipment_id: string; rate_id: string }[] }`
  - `BulkFulfillOrdersStepOutput = { succeeded: string[]; failed: { order_id: string; error: string; easypost_shipment_id?: string }[]; label_pdf_url?: string }`

- [ ] **Step 1: Write failing tests**

```ts
it("buys the chosen rate and overrides provider data on createOrderFulfillmentWorkflow", async () => {
  // mock container.resolve("fp_easypost") to return { buyRate: jest.fn()
  // .mockResolvedValue({ id: "shp_1", trackingCode: "trk_1", labelUrl: "url" }),
  // createLabelBatch: jest.fn().mockResolvedValue({ labelUrl: "batch.pdf" }) }
  // mock createOrderFulfillmentWorkflow(container).run to resolve normally
  const result = await bulkFulfillOrdersStep.invoke(
    { fulfillments: [{ order_id: "order_1", location_id: "sloc_1", shipment_id: "shp_quote", rate_id: "rate_1" }] },
    context
  )
  expect(result.output.succeeded).toEqual(["order_1"])
  expect(result.output.label_pdf_url).toBe("batch.pdf")
})

it("records the bought shipment id on a failure entry when buyRate succeeds but fulfillment creation fails", async () => {
  // buyRate resolves; createOrderFulfillmentWorkflow(container).run rejects
  const result = await bulkFulfillOrdersStep.invoke(
    { fulfillments: [{ order_id: "order_1", shipment_id: "shp_quote", rate_id: "rate_1" }] },
    context
  )
  expect(result.output.failed).toEqual([
    { order_id: "order_1", error: expect.any(String), easypost_shipment_id: "shp_1" },
  ])
})

it("one order's buyRate failure does not block the others in the same batch", async () => {
  // first fulfillment's buyRate rejects, second's buyRate+workflow resolve
  const result = await bulkFulfillOrdersStep.invoke(
    { fulfillments: [
      { order_id: "order_fail", shipment_id: "shp_a", rate_id: "rate_a" },
      { order_id: "order_ok", shipment_id: "shp_b", rate_id: "rate_b" },
    ] },
    context
  )
  expect(result.output.succeeded).toEqual(["order_ok"])
  expect(result.output.failed.map((f) => f.order_id)).toEqual(["order_fail"])
})

it("a label-batch generation failure does not undo already-succeeded fulfillments", async () => {
  // buyRate + workflow.run resolve; createLabelBatch rejects
  const result = await bulkFulfillOrdersStep.invoke(
    { fulfillments: [{ order_id: "order_1", shipment_id: "shp_1", rate_id: "rate_1" }] },
    context
  )
  expect(result.output.succeeded).toEqual(["order_1"])
  expect(result.output.label_pdf_url).toBeUndefined()
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/core/core-flows && yarn jest bulk-fulfill-orders`
Expected: FAIL (old `order_ids`-shaped input, no buy/label-batch logic)

- [ ] **Step 3: Implement the step**

Resolve `const easypost = container.resolve("fp_easypost")` once, outside the loop (comment explaining this step is scoped to the EasyPost provider specifically, matching this codebase's existing pragmatic EasyPost-specific code paths like the webhook route — see Global Constraints). For each entry in `input.fulfillments`: fetch the order's remaining unfulfilled items exactly as today (lines 64-85, unchanged — just keyed by `fulfillment.order_id` now). In an inner try/catch around just the buy call, call `easypost.buyRate(fulfillment.shipment_id, fulfillment.rate_id)`; on success, build `providerDataOverride = { easypost_shipment_id: bought.id, easypost_rate_id: fulfillment.rate_id, easypost_tracking_code: bought.trackingCode, easypost_label_url: bought.labelUrl, easypost_tracker_id: bought.trackerId }` and push `bought.id` onto a local `boughtShipmentIds` array; on failure, push to `failed` (no shipment id) and `continue` to the next fulfillment. In a second try/catch, call `createOrderFulfillmentWorkflow(container).run({ input: { order_id: fulfillment.order_id, items, location_id: fulfillment.location_id, provider_data_override: providerDataOverride } })`; on success push to `succeeded`; on failure push to `failed` **with** `easypost_shipment_id: providerDataOverride.easypost_shipment_id` (this is the orphaned-label case the Review Focus item names). After the loop, if `boughtShipmentIds.length > 0`, try `createLabelBatch(boughtShipmentIds, "pdf")` and set `labelPdfUrl` from its result; on failure, resolve the container's logger (`ContainerRegistrationKeys.LOGGER`, same pattern as `ContainerRegistrationKeys.QUERY` already used in this file) and log a warning, leaving `labelPdfUrl` undefined. Return `new StepResponse({ succeeded, failed, label_pdf_url: labelPdfUrl })`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd packages/core/core-flows && yarn jest bulk-fulfill-orders`
Expected: PASS

- [ ] **Step 5: Update `bulk-fulfill-orders.ts` workflow's doc-comment example**

Update the `@example` block (lines 24-30) to show the new `fulfillments` array shape instead of `order_ids` — no code change needed in this file beyond the comment, since it passes `input` straight through to the step.

- [ ] **Step 6: Commit**

```bash
git add packages/core/core-flows/src/order/steps/bulk-fulfill-orders.ts packages/core/core-flows/src/order/workflows/bulk-fulfill-orders.ts packages/core/core-flows/src/order/steps/__tests__/bulk-fulfill-orders.unit.spec.ts
git commit -m "feat(core-flows): buy the chosen EasyPost rate and consolidate labels in bulkFulfillOrdersStep"
```

---

### Task 5: Admin Bulk Fulfill Orders route — new payload shape

**Files:**
- Modify: `packages/medusa/src/api/admin/orders/validators.ts`
- Modify: `packages/medusa/src/api/admin/orders/fulfillments/batch/route.ts`
- Test: `apps/backend/integration-tests/http/bulk-fulfill-orders.spec.ts` (new file, following this app's existing `integration-tests/http/*.spec.ts` conventions — check an existing sibling spec, e.g. the fulfillment-status-filter or bulk-fulfill HTTP test mentioned in recent commit history, for the exact test-db/auth setup helpers to reuse)

**Interfaces:**
- Consumes: `bulkFulfillOrdersWorkflow` (Task 4's new input/output shape).
- Produces: `AdminBulkFulfillOrdersType` (zod-inferred) matching `{ fulfillments: { order_id: string; location_id?: string; shipment_id: string; rate_id: string }[] }`. Route response shape: `{ succeeded: string[]; failed: { order_id: string; error: string; easypost_shipment_id?: string }[]; label_pdf_url?: string }`.

- [ ] **Step 1: Write failing HTTP integration tests**

```ts
it("fulfills each order with its chosen rate and returns a consolidated label url", async () => {
  const response = await api.post(
    "/admin/orders/fulfillments/batch",
    { fulfillments: [{ order_id: order.id, location_id, shipment_id: "shp_1", rate_id: "rate_1" }] },
    adminHeaders
  )
  expect(response.status).toBe(200)
  expect(response.data.succeeded).toEqual([order.id])
  expect(response.data.label_pdf_url).toBeDefined()
})

it("rejects a request with the old order_ids shape", async () => {
  const response = await api
    .post("/admin/orders/fulfillments/batch", { order_ids: [order.id] }, adminHeaders)
    .catch((e) => e.response)
  expect(response.status).toBe(400)
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/backend && yarn test:integration:http -- bulk-fulfill-orders`
Expected: FAIL

- [ ] **Step 3: Replace the `AdminBulkFulfillOrders` zod schema**

In `validators.ts` (lines 197-202), replace with:

```ts
export type AdminBulkFulfillOrdersType = z.infer<typeof AdminBulkFulfillOrders>
export const AdminBulkFulfillOrders = z
  .object({
    fulfillments: z
      .array(
        z.object({
          order_id: z.string(),
          location_id: z.string().optional(),
          shipment_id: z.string(),
          rate_id: z.string(),
        })
      )
      .min(1),
  })
  .strict()
```

- [ ] **Step 4: Update the route handler**

In `route.ts`, destructure `const { fulfillments } = req.validatedBody` and pass `{ input: { fulfillments } }` to `bulkFulfillOrdersWorkflow(req.scope).run(...)`. Update the `res: MedusaResponse<...>` type annotation to include the optional `label_pdf_url?: string` field alongside the existing `succeeded`/`failed`.

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd apps/backend && yarn test:integration:http -- bulk-fulfill-orders`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/medusa/src/api/admin/orders/validators.ts packages/medusa/src/api/admin/orders/fulfillments/batch/route.ts apps/backend/integration-tests/http/bulk-fulfill-orders.spec.ts
git commit -m "feat(medusa): accept per-order shipment/rate ids on the bulk fulfill orders route"
```

---

### Task 6: New admin route — quote all carrier rates for one order

**Files:**
- Create: `apps/backend/src/api/admin/orders/[id]/carrier-rates/route.ts`
- Test: `apps/backend/integration-tests/http/carrier-rates.spec.ts`

**Interfaces:**
- Consumes: `req.scope.resolve("fp_easypost")` → `quoteAllRates` (Task 2); `toEasyPostAddress` exported from `@dtc/fulfillment-easypost` (Task 2, Step 5).
- Produces: `POST /admin/orders/:id/carrier-rates` — request body `{ location_id: string; parcel: { predefined_package?: string; weight: number; length?: number; width?: number; height?: number } }`; response `{ shipment_id: string; rates: { carrier: string; service: string; name: string; rate_id: string; amount: string; currency: string }[] }`.

- [ ] **Step 1: Write failing integration tests**

```ts
it("returns quoted rates sorted cheapest-first for a valid order/location/parcel", async () => {
  const response = await api.post(
    `/admin/orders/${order.id}/carrier-rates`,
    { location_id, parcel: { weight: 16 } },
    adminHeaders
  )
  expect(response.status).toBe(200)
  expect(response.data.rates.length).toBeGreaterThan(0)
  expect(response.data.shipment_id).toBeDefined()
})

it("returns a 400 when the order's shipping address is incomplete", async () => {
  const response = await api
    .post(`/admin/orders/${orderWithIncompleteAddress.id}/carrier-rates`, { location_id, parcel: { weight: 16 } }, adminHeaders)
    .catch((e) => e.response)
  expect(response.status).toBe(400)
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/backend && yarn test:integration:http -- carrier-rates`
Expected: FAIL (404, route doesn't exist)

- [ ] **Step 3: Implement the route**

Resolve the order's `shipping_address.*` and the given `location_id`'s stock location `address.*` via `req.scope.resolve(ContainerRegistrationKeys.QUERY).graph(...)` (same pattern as `apps/backend/src/api/admin/fulfillment-queue/route.ts`'s use of workflows, but a direct `query.graph` call here since no existing workflow fits). Map both addresses with the now-exported `toEasyPostAddress` (catching and converting its thrown `MedusaError` into a `400` JSON response — `res.status(400).json({ message: error.message })` — rather than letting it 500). Resolve `const provider = req.scope.resolve("fp_easypost")`, call `provider.quoteAllRates(req.body.parcel, fromAddress, toAddress)`, respond `res.json({ shipment_id: result.shipmentId, rates: result.rates.map((r) => ({ carrier: r.carrier, service: r.service, name: r.name, rate_id: r.rateId, amount: r.amount, currency: r.currency })) })`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd apps/backend && yarn test:integration:http -- carrier-rates`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/admin/orders/[id]/carrier-rates/route.ts apps/backend/integration-tests/http/carrier-rates.spec.ts
git commit -m "feat(backend): add admin route to quote all carrier rates for an order"
```

---

### Task 7: Settings — default Ship From location and per-sales-channel SLA

**Files:**
- Create: `apps/backend/src/admin/routes/settings/fulfillment/page.tsx`
- Test: `apps/backend/src/admin/routes/settings/fulfillment/__tests__/page.unit.spec.tsx` (follow this app's existing admin-route test convention, e.g. `apps/backend/src/api/admin/fulfillment-queue/__tests__/build-queue-page.unit.spec.ts`'s sibling pattern for a React-rendered admin page if one exists, otherwise a standard RTL render test)

**Interfaces:**
- Consumes: `sdk.admin.store.list()` / `sdk.admin.store.update(id, { metadata })`, `sdk.admin.stockLocation.list()`, `sdk.admin.salesChannel.list()` / `sdk.admin.salesChannel.update(id, { metadata })` (all existing `@medusajs/js-sdk` methods, confirmed signatures).
- Produces: a Settings page registered via `defineRouteConfig({ label: "Fulfillment" })` under the `settings/` route segment (Medusa's documented convention for placing a custom route under the admin's Settings section — verify this placement against the `medusa` MCP server or `building-admin-dashboard-customizations` skill if available before implementing, per `AGENTS.md`'s guidance to prefer those over guessing).

- [ ] **Step 1: Write a failing render test**

```tsx
it("renders the current default ship-from location and lets the admin change it", async () => {
  // mock sdk.admin.store.list to resolve one store with metadata.default_ship_from_location_id
  // mock sdk.admin.stockLocation.list to resolve two locations
  render(<FulfillmentSettingsPage />)
  expect(await screen.findByText(/Warehouse A/)).toBeInTheDocument()
})

it("renders a handling-hours input per sales channel and saves on change", async () => {
  // mock sdk.admin.salesChannel.list to resolve two channels
  render(<FulfillmentSettingsPage />)
  const input = await screen.findByLabelText(/Amazon/i)
  fireEvent.change(input, { target: { value: "24" } })
  fireEvent.blur(input)
  await waitFor(() => expect(mockSalesChannelUpdate).toHaveBeenCalledWith(
    "sc_amazon",
    expect.objectContaining({ metadata: expect.objectContaining({ handling_hours: 24 }) })
  ))
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/backend && yarn test:unit -- settings/fulfillment`
Expected: FAIL (component doesn't exist)

- [ ] **Step 3: Implement the page**

Two sections in one `Container`: (1) a `Select` of stock locations (from `sdk.admin.stockLocation.list()`), value from the first store's (`sdk.admin.store.list()`) `metadata?.default_ship_from_location_id`, `onValueChange` calls `sdk.admin.store.update(store.id, { metadata: { ...store.metadata, default_ship_from_location_id: value } })`. (2) a list of sales channels (`sdk.admin.salesChannel.list()`), each row a labeled number `Input` bound to `channel.metadata?.handling_hours`, saving on blur via `sdk.admin.salesChannel.update(channel.id, { metadata: { ...channel.metadata, handling_hours: Number(value) } })`. Export `config = defineRouteConfig({ label: "Fulfillment" })`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd apps/backend && yarn test:unit -- settings/fulfillment`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin/routes/settings/fulfillment/page.tsx apps/backend/src/admin/routes/settings/fulfillment/__tests__/page.unit.spec.tsx
git commit -m "feat(backend): add Fulfillment settings page for default ship-from location and sales channel SLAs"
```

---

### Task 8: Frontend — Item column (thumbnail + title + qty, stacked)

**Files:**
- Create: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/item-cell.tsx`
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx`
- Test: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/item-cell.spec.tsx`

**Interfaces:**
- Consumes: `HttpTypes.AdminOrderLineItem[]` (already fetched — `READY_TO_SHIP_FIELDS` already includes `*items`, `+items.detail.fulfilled_quantity`; no fields change needed).
- Produces: `ItemCell({ items }: { items: HttpTypes.AdminOrderLineItem[] })`, a new `item` column inserted between `customer` and `ship_from` in `useReadyToShipTableColumns`.

- [ ] **Step 1: Write a failing test**

```tsx
it("renders thumbnail, title, and remaining quantity for every line item, stacked", () => {
  render(<ItemCell items={[
    { id: "li_1", title: "Red Shirt", thumbnail: "shirt.png", quantity: 3, detail: { fulfilled_quantity: 1 } },
    { id: "li_2", title: "Blue Hat", thumbnail: "hat.png", quantity: 1, detail: { fulfilled_quantity: 0 } },
  ]} />)
  expect(screen.getByText("Red Shirt")).toBeInTheDocument()
  expect(screen.getByText("2x")).toBeInTheDocument() // 3 - 1 remaining
  expect(screen.getByText("Blue Hat")).toBeInTheDocument()
  expect(screen.getByText("1x")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd packages/admin/dashboard && yarn jest item-cell`
Expected: FAIL

- [ ] **Step 3: Implement `ItemCell`**

A `flex flex-col` of rows, one per item: an `<img>` (thumbnail, fallback to a placeholder icon when `item.thumbnail` is falsy — reuse whatever existing thumbnail-fallback convention this dashboard already has elsewhere, e.g. check `components/table/table-cells` for an existing thumbnail cell to match styling, same `overflow-hidden`/`truncate` conventions as `PackageCell` in `ready-to-ship-table.tsx`), the title, and remaining quantity computed the same way `getFulfillableQuantity` (already imported in `fulfill-confirm-popover.tsx` from `lib/order-item`) does — reuse that helper rather than re-deriving `quantity - detail.fulfilled_quantity` locally.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd packages/admin/dashboard && yarn jest item-cell`
Expected: PASS

- [ ] **Step 5: Wire the column into `ready-to-ship-table.tsx`**

Add a `columnHelper.display({ id: "item", ... cell: ({ row }) => <ItemCell items={row.original.items ?? []} /> })` entry between the `customer` and `ship_from` columns in `useReadyToShipTableColumns` (around line 251-266).

- [ ] **Step 6: Commit**

```bash
git add packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/item-cell.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/item-cell.spec.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx
git commit -m "feat(dashboard): add Item column with thumbnail, title, and remaining quantity to Ready to Ship table"
```

---

### Task 9: Frontend — Package popover (preset list + custom, with weight validation)

**Files:**
- Create: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/package-popover.tsx`
- Create: `packages/admin/dashboard/src/lib/easypost-package-presets.ts` (the hardcoded preset list)
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx`
- Test: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/package-popover.spec.tsx`

**Interfaces:**
- Consumes: `computeOrderParcel` (`lib/order-parcel.ts`, unchanged) as the initial value.
- Produces: `EASYPOST_PACKAGE_PRESETS: { carrier: "USPS" | "FedEx"; code: string; label: string }[]` (lib file). `PackagePopover({ initialParcel, onChange }: { initialParcel: OrderParcel; onChange: (parcel: { predefinedPackage?: string; weight: number; length?: number; width?: number; height?: number }) => void })`.

- [ ] **Step 1: Write failing tests**

```tsx
it("lists USPS and FedEx presets grouped by carrier", () => {
  render(<PackagePopover initialParcel={parcel} onChange={jest.fn()} />)
  fireEvent.click(screen.getByRole("button")) // open trigger
  expect(screen.getByText("USPS")).toBeInTheDocument()
  expect(screen.getByText("FedEx")).toBeInTheDocument()
})

it("calls onChange with the predefined_package code when a preset is picked", () => {
  const onChange = jest.fn()
  render(<PackagePopover initialParcel={parcel} onChange={onChange} />)
  fireEvent.click(screen.getByRole("button"))
  fireEvent.click(screen.getByText("USPS Small Flat Rate Box"))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ predefinedPackage: "SmallFlatRateBox" }))
})

it("blocks confirming a custom package with empty or zero weight", () => {
  const onChange = jest.fn()
  render(<PackagePopover initialParcel={parcel} onChange={onChange} />)
  fireEvent.click(screen.getByRole("button"))
  fireEvent.click(screen.getByText("Custom"))
  fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: "0" } })
  fireEvent.click(screen.getByRole("button", { name: /confirm|save/i }))
  expect(screen.getByText(/weight is required/i)).toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/admin/dashboard && yarn jest package-popover`
Expected: FAIL

- [ ] **Step 3: Write `EASYPOST_PACKAGE_PRESETS`**

A flat array, each entry `{ carrier: "USPS", code: "SmallFlatRateBox", label: "USPS Small Flat Rate Box" }` etc. — pin the exact set of codes against EasyPost's current documented `predefined_package` enum before filling this in (flagged in the spec's Open Items; do a quick doc check, don't invent codes).

- [ ] **Step 4: Implement `PackagePopover`**

A `Popover` whose trigger shows the current parcel (preset label, or `` `Custom — ${length}x${width}x${height}, ${weight}` `` when no preset is selected — reuse `formatPackageField`'s "Not set" convention from `ready-to-ship-table.tsx` for any missing field). Content: a radio list grouped by carrier (`EASYPOST_PACKAGE_PRESETS`) plus a "Custom" radio revealing four number inputs (weight required and validated `> 0` on confirm, showing an inline error and not calling `onChange` otherwise; length/width/height optional, matching `OrderParcel`'s own nullable shape). A Confirm button calls `onChange` with the selected preset's `{ predefinedPackage: code, weight }` or the custom `{ weight, length, width, height }` and closes the popover.

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd packages/admin/dashboard && yarn jest package-popover`
Expected: PASS

- [ ] **Step 6: Wire into `ready-to-ship-table.tsx`**

Replace the `package` column's `cell` (currently `<PackageCell items={row.original.items ?? []} />`, line ~267-274) with `<PackagePopover initialParcel={computeOrderParcel(row.original.items ?? [])} onChange={(parcel) => setRowPackage(row.original.id, parcel)} />`, where `setRowPackage` updates a new piece of `ReadyToShipTable` local state (a `Record<string, PackageSelection>`, keyed by order id) — this state is Task 11's dependency for re-quoting, so define it here as `const [rowPackages, setRowPackages] = useState<Record<string, PackageSelection>>({})` with a `PackageSelection` type matching `PackagePopover`'s `onChange` payload, exported from this file for Task 11/13 to import.

- [ ] **Step 7: Commit**

```bash
git add packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/package-popover.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/package-popover.spec.tsx packages/admin/dashboard/src/lib/easypost-package-presets.ts packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx
git commit -m "feat(dashboard): add interactive Package popover with USPS/FedEx presets and custom dimensions"
```

---

### Task 10: Frontend — Ship From select (store default + instant per-row override)

**Files:**
- Create: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-from-select.tsx`
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx`
- Add hook: `packages/admin/dashboard/src/hooks/api/stock-locations.tsx` (if no existing `useStockLocations` hook already exists in this hooks directory — check first; reuse it if one does)
- Add hook: `packages/admin/dashboard/src/hooks/api/store.tsx` (a `useStore` wrapping `sdk.admin.store.list()`, if none exists)
- Test: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-from-select.spec.tsx`

**Interfaces:**
- Consumes: `useStockLocations()` (new or existing), `useStore()` (new, for `metadata.default_ship_from_location_id`).
- Produces: `ShipFromSelect({ orderId, defaultLocationId, onChange }: { orderId: string; defaultLocationId: string | null; onChange: (locationId: string) => void })`.

- [ ] **Step 1: Write failing tests**

```tsx
it("defaults to the store's configured default location", async () => {
  render(<ShipFromSelect orderId="order_1" defaultLocationId="sloc_default" onChange={jest.fn()} />)
  expect(await screen.findByText("Warehouse A")).toBeInTheDocument()
})

it("calls onChange immediately when a different location is picked", async () => {
  const onChange = jest.fn()
  render(<ShipFromSelect orderId="order_1" defaultLocationId="sloc_default" onChange={onChange} />)
  fireEvent.click(await screen.findByRole("combobox"))
  fireEvent.click(screen.getByText("Warehouse B"))
  expect(onChange).toHaveBeenCalledWith("sloc_b")
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/admin/dashboard && yarn jest ship-from-select`
Expected: FAIL

- [ ] **Step 3: Implement `ShipFromSelect`**

A `Select` populated from `useStockLocations()`'s `stock_locations`, value defaulting to `defaultLocationId` (from the store setting, resolved once by the parent table — see Step 5), `onValueChange={onChange}`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd packages/admin/dashboard && yarn jest ship-from-select`
Expected: PASS

- [ ] **Step 5: Wire into `ready-to-ship-table.tsx`**

`ReadyToShipTable` fetches the store default once via `useStore()` and derives `defaultLocationId = store?.metadata?.default_ship_from_location_id ?? null`. Replace the `ship_from` column's `cell` (currently `<ShipFromCell shippingMethod={...} />`, line ~262-264) with `<ShipFromSelect orderId={row.original.id} defaultLocationId={rowLocationOverride[row.original.id] ?? defaultLocationId} onChange={(id) => setRowLocationOverride(row.original.id, id)} />`, tracked in a new `rowLocationOverride` state alongside `rowPackages` (Task 9, Step 6) — same keyed-by-order-id shape.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-from-select.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-from-select.spec.tsx packages/admin/dashboard/src/hooks/api/stock-locations.tsx packages/admin/dashboard/src/hooks/api/store.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx
git commit -m "feat(dashboard): make Ship From an editable per-row select defaulting to the store setting"
```

---

### Task 11: Frontend — Shipping Rate select (live quote per row, dropdown of all rates)

**Files:**
- Create: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/shipping-rate-select.tsx`
- Modify: `packages/admin/dashboard/src/hooks/api/orders.tsx` (add `useOrderCarrierRates`)
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx`
- Test: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/shipping-rate-select.spec.tsx`

**Interfaces:**
- Consumes: `POST /admin/orders/:id/carrier-rates` (Task 6).
- Produces:
  - `useOrderCarrierRates(orderId: string, params: { location_id: string; parcel: PackageSelection }, options?: { enabled?: boolean })` — a `useQuery` wrapper, `queryKey: ["orders", orderId, "carrier-rates", params]`, `queryFn: () => sdk.client.fetch(...)` (there is no existing SDK method for this new route — call `sdk.client.fetch` directly inside the hook, same low-level pattern the `FulfillmentQueuePage` admin route component already uses for its own non-core route).
  - `ShippingRateSelect({ orderId, locationId, parcel, onChange }: { orderId: string; locationId: string; parcel: PackageSelection; onChange: (rate: { shipmentId: string; rateId: string }) => void })` — auto-selects the cheapest rate on a successful quote (via `onChange`, in a `useEffect` keyed on the query's data), renders a dropdown of every quoted rate.

- [ ] **Step 1: Write failing tests**

```tsx
it("auto-selects the cheapest rate once quoted", async () => {
  const onChange = jest.fn()
  // mock useOrderCarrierRates / the underlying fetch to resolve two rates,
  // FedEx Ground at 7.50 and USPS Priority at 9.00
  render(<ShippingRateSelect orderId="order_1" locationId="sloc_1" parcel={parcel} onChange={onChange} />)
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ shipmentId: "shp_1", rateId: "rate_fedex" }))
  expect(await screen.findByText(/FedEx Ground/)).toBeInTheDocument()
})

it("lets the admin pick a different quoted rate from the dropdown", async () => {
  const onChange = jest.fn()
  render(<ShippingRateSelect orderId="order_1" locationId="sloc_1" parcel={parcel} onChange={onChange} />)
  await screen.findByText(/FedEx Ground/)
  fireEvent.click(screen.getByRole("combobox"))
  fireEvent.click(screen.getByText(/USPS Priority/))
  expect(onChange).toHaveBeenLastCalledWith({ shipmentId: "shp_1", rateId: "rate_usps" })
})

it("shows an inline error with retry when quoting fails", async () => {
  // mock the fetch to reject
  render(<ShippingRateSelect orderId="order_1" locationId="sloc_1" parcel={parcel} onChange={jest.fn()} />)
  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/admin/dashboard && yarn jest shipping-rate-select`
Expected: FAIL

- [ ] **Step 3: Implement `useOrderCarrierRates`**

Add to `hooks/api/orders.tsx`, following the file's existing `useQuery`-wrapper style (e.g. `usePreviewOrder`): `queryFn: async () => sdk.client.fetch<{ shipment_id: string; rates: {...}[] }>(\`/admin/orders/${orderId}/carrier-rates\`, { method: "POST", body: params })`.

- [ ] **Step 4: Implement `ShippingRateSelect`**

Calls `useOrderCarrierRates`. On successful load with `data.rates.length > 0`, a `useEffect` calls `onChange({ shipmentId: data.shipment_id, rateId: data.rates[0].rate_id })` (already sorted cheapest-first by the backend) the first time data arrives for a given query key — guard with a ref so re-selecting a different rate from the dropdown doesn't get immediately overwritten by this effect re-firing on the same data. Renders a `Select` of `data.rates` (label `` `${rate.name} — ${rate.amount} ${rate.currency}` ``), `onValueChange` calls `onChange({ shipmentId: data.shipment_id, rateId: selectedId })`. On error, render an inline message + a "Retry" button calling the query's `refetch`.

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd packages/admin/dashboard && yarn jest shipping-rate-select`
Expected: PASS

- [ ] **Step 6: Wire into `ready-to-ship-table.tsx`**

Replace the `shipping_rate` column's `cell` with `<ShippingRateSelect orderId={row.original.id} locationId={rowLocationOverride[row.original.id] ?? defaultLocationId} parcel={rowPackages[row.original.id] ?? computeOrderParcel(row.original.items ?? [])} onChange={(rate) => setRowRate(row.original.id, rate)} />`, tracked in a new `rowRates` state (same keyed-by-order-id shape as Tasks 9/10). Per the design's "auto-quote all rows on the current page" decision, every row quotes unconditionally once rendered — no additional viewport/intersection logic needed (`enablePagination` already bounds this to `PAGE_SIZE` rows). Changing `rowPackages[orderId]` or `rowLocationOverride[orderId]` naturally changes this query's key, triggering a re-quote.

- [ ] **Step 7: Commit**

```bash
git add packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/shipping-rate-select.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/shipping-rate-select.spec.tsx packages/admin/dashboard/src/hooks/api/orders.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx
git commit -m "feat(dashboard): add live multi-carrier Shipping Rate select to Ready to Ship table"
```

---

### Task 12: Frontend — Ship Date / Ship Time (Overdue) column

**Files:**
- Create: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-by-cell.tsx`
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx`
- Test: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-by-cell.spec.tsx`

**Interfaces:**
- Consumes: `order.created_at`, `order.sales_channel.metadata.handling_hours` (already fetched — `*sales_channel` is in `DEFAULT_RELATIONS`, inherited by `READY_TO_SHIP_RELATIONS`; `metadata` needs to be explicitly added to the fields list since `*sales_channel` as currently written may not expand `metadata` — verify by checking the fetched order shape in a quick manual check before writing the test, and add `+sales_channel.metadata` to `READY_TO_SHIP_RELATIONS` in `const.ts` if it isn't already included).
- Produces: `ShipByCell({ createdAt, handlingHours }: { createdAt: string; handlingHours: number | null | undefined })`.

- [ ] **Step 1: Write failing tests**

```tsx
it("renders the deadline date and a live countdown when not yet overdue", () => {
  const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago
  render(<ShipByCell createdAt={createdAt} handlingHours={24} />)
  expect(screen.getByText(/left/i)).toBeInTheDocument() // e.g. "22h left"
})

it("renders an Overdue badge once the deadline has passed", () => {
  const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48h ago
  render(<ShipByCell createdAt={createdAt} handlingHours={24} />)
  expect(screen.getByText(/overdue/i)).toBeInTheDocument()
})

it("renders a defined no-SLA state when the sales channel has no handling_hours configured", () => {
  render(<ShipByCell createdAt={new Date().toISOString()} handlingHours={null} />)
  expect(screen.getByText(/no sla set/i)).toBeInTheDocument()
  expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/admin/dashboard && yarn jest ship-by-cell`
Expected: FAIL

- [ ] **Step 3: Implement `ShipByCell`**

When `handlingHours` is `null`/`undefined`, render a muted "No SLA set" text and stop there (the Review Focus case). Otherwise compute `deadline = new Date(createdAt).getTime() + handlingHours * 3600_000`; render the deadline's date (reuse `DateCell` or the same date-formatting convention `created_at`'s column already uses elsewhere in this file) plus either a live countdown string (hours/minutes remaining, recomputed on an interval — reuse any existing countdown/interval hook in this dashboard if one exists, otherwise a local `setInterval` in a `useEffect` ticking once a minute) or, once `Date.now() > deadline`, a destructive-variant `Badge` reading "Overdue" (same `Badge` component already imported in this table's file via `@medusajs/ui`).

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd packages/admin/dashboard && yarn jest ship-by-cell`
Expected: PASS

- [ ] **Step 5: Wire into `ready-to-ship-table.tsx`**

Add two columns (`ship_date`, `ship_time`, or one combined `ship_by` column rendering both pieces of `ShipByCell` — match whichever the design's two-column decision implies most directly, i.e. two separate `columnHelper.display` entries both rendering from the same computed deadline) between `created_at` and `total`. If `sales_channel.metadata` isn't already in the fetched fields (checked in this task's Interfaces note), add `+sales_channel.metadata` to `READY_TO_SHIP_RELATIONS` in `const.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-by-cell.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ship-by-cell.spec.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx packages/admin/dashboard/src/routes/orders/order-list/const.ts
git commit -m "feat(dashboard): add Ship Date and Ship Time/Overdue columns to Ready to Ship table"
```

---

### Task 13: Frontend — wire bulk/single fulfill to the new payload, "Print N labels" link

**Files:**
- Modify: `packages/admin/dashboard/src/hooks/api/orders.tsx` (`useBulkFulfillOrders` payload/result types)
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx` (bulk command action)
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/fulfill-confirm-popover.tsx` (switch from `useCreateOrderFulfillment` to `useBulkFulfillOrders` with a one-item array)
- Modify: `packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/bulk-fulfill-result-summary.tsx` (`label_pdf_url` prop + link)
- Test: extend `ready-to-ship-table.spec.tsx`, `fulfill-confirm-popover.spec.tsx`, `bulk-fulfill-result-summary.spec.tsx` (existing files)

**Interfaces:**
- Consumes: `POST /admin/orders/fulfillments/batch` new shape (Task 5); `rowPackages`/`rowLocationOverride`/`rowRates` state (Tasks 9-11); a row is only fulfillable once `rowRates[orderId]` is populated (a successful quote exists) — this replaces/extends `orderHasShippingMethod`'s current sole gating condition.
- Produces: `BulkFulfillOrdersResult` gains `label_pdf_url?: string`. `useBulkFulfillOrders`'s mutation payload type becomes `{ fulfillments: { order_id: string; location_id?: string; shipment_id: string; rate_id: string }[] }`.

- [ ] **Step 1: Write failing tests**

```tsx
// bulk-fulfill-result-summary.spec.tsx
it("renders a Print N labels link when label_pdf_url is present", () => {
  render(<BulkFulfillResultSummary result={{ succeeded: ["o1"], failed: [], label_pdf_url: "https://x/batch.pdf" }} onDismiss={jest.fn()} />)
  expect(screen.getByRole("link", { name: /print 1 label/i })).toHaveAttribute("href", "https://x/batch.pdf")
})

// ready-to-ship-table.spec.tsx
it("sends each selected row's package/location/rate on Fulfill Selected", async () => {
  // select two rows with distinct rowPackages/rowLocationOverride/rowRates state already set
  // click "Fulfill Selected", confirm the prompt
  expect(mockBulkFulfillMutate).toHaveBeenCalledWith({
    fulfillments: [
      { order_id: "o1", location_id: "sloc_a", shipment_id: "shp_a", rate_id: "rate_a" },
      { order_id: "o2", location_id: "sloc_b", shipment_id: "shp_b", rate_id: "rate_b" },
    ],
  })
})

// fulfill-confirm-popover.spec.tsx
it("calls useBulkFulfillOrders with a one-item fulfillments array on Confirm", async () => {
  // render with a row whose rowPackages/rowLocationOverride/rowRates are set
  fireEvent.click(screen.getByText(/fulfill/i))
  fireEvent.click(screen.getByText(/confirm/i))
  expect(mockBulkFulfillMutate).toHaveBeenCalledWith({
    fulfillments: [{ order_id: order.id, location_id: "sloc_a", shipment_id: "shp_a", rate_id: "rate_a" }],
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd packages/admin/dashboard && yarn jest ready-to-ship-table fulfill-confirm-popover bulk-fulfill-result-summary`
Expected: FAIL

- [ ] **Step 3: Update `BulkFulfillOrdersResult` and `useBulkFulfillOrders`**

In `hooks/api/orders.tsx`: `BulkFulfillOrdersResult` gains `label_pdf_url?: string`. `useBulkFulfillOrders`'s `UseMutationOptions`/`mutationFn` payload type changes from `{ order_ids: string[] }` to `{ fulfillments: { order_id: string; location_id?: string; shipment_id: string; rate_id: string }[] }`, passed straight through to `sdk.admin.order.bulkFulfill` (whose own type, in `packages/core/js-sdk/src/admin/order.ts`, must be updated to match — same body/response shape change as Task 5's route, mirrored here; add this file to this task's **Files** and update `bulkFulfill`'s `body` and response types accordingly).

- [ ] **Step 4: Update `BulkFulfillResultSummary`**

Add `label_pdf_url?: string` to `BulkFulfillResultSummaryProps`'s `result`. When present, render an `<a href={result.label_pdf_url} target="_blank">` reading `` `Print ${succeeded.length} label${succeeded.length === 1 ? "" : "s"}` ``, inside the existing success/warning `Alert`.

- [ ] **Step 5: Update `ReadyToShipTable`'s bulk command**

In the command's `action`, build `fulfillments` from `Object.keys(selection)`, reading each order id's `rowPackages`/`rowLocationOverride`/`rowRates` state (Tasks 9-11) — skip (and surface, e.g. via the existing `toast.error`) any selected order whose `rowRates` entry isn't populated yet (quote still loading or failed), since `shipment_id`/`rate_id` are required. Call `bulkFulfillOrders({ fulfillments })`.

- [ ] **Step 6: Update `FulfillConfirmPopover`**

Replace `useCreateOrderFulfillment(order.id)` with `useBulkFulfillOrders()`. `handleConfirm` calls `mutateAsync({ fulfillments: [{ order_id: order.id, location_id: rowLocationOverride[order.id] ?? locationId, shipment_id: rowRates[order.id]?.shipmentId, rate_id: rowRates[order.id]?.rateId }] })` — this component now needs `rowLocationOverride`/`rowRates` passed down as props from `ReadyToShipTable` (it currently only receives `order`; widen `FulfillConfirmPopoverProps` accordingly, matching however Tasks 9-11 already pass this per-row state down to the other per-row cell components in the same file).

- [ ] **Step 7: Update the row-selection/fulfillability gate**

`orderHasShippingMethod` (used by both `enableRowSelection` and the single-row button's disabled state) stays as the baseline "has a shipping method at all" check, but both the bulk checkbox and `FulfillConfirmPopover` additionally require `rowRates[order.id]` to be populated — extend the `enableRowSelection` predicate and `FulfillConfirmPopover`'s `hasShippingMethod` guard to also check this, per Task 11's note that quoting gates fulfillability.

- [ ] **Step 8: Run tests, verify they pass**

Run: `cd packages/admin/dashboard && yarn jest ready-to-ship-table fulfill-confirm-popover bulk-fulfill-result-summary`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/admin/dashboard/src/hooks/api/orders.tsx packages/core/js-sdk/src/admin/order.ts packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/ready-to-ship-table.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/fulfill-confirm-popover.tsx packages/admin/dashboard/src/routes/orders/order-list/components/order-list-table/components/bulk-fulfill-result-summary.tsx
git commit -m "feat(dashboard): wire bulk and single fulfill to per-row package/location/rate selections with label printing"
```

---

## Self-review notes

- **Spec coverage**: every Decisions/Goals item in the spec maps to a task — provider-level rate shopping/buy/label-batch (Tasks 1-2), the override plumbing (Task 3), orchestration (Task 4), the two API surface changes (Tasks 5-6), Settings (Task 7), and all five UI columns plus the fulfill wiring (Tasks 8-13).
- **Simplification found during planning**: the spec's data-flow sketch listed `parcel` in the bulk-fulfill payload; it was dropped (Tasks 4-5) because the EasyPost shipment created at quote time already bakes in the parcel — buying only needs `shipment_id`/`rate_id`. This doesn't change any acceptance criterion.
- **Type consistency**: `PackageSelection` (Task 9), `rowLocationOverride`/`rowRates` (Tasks 10-11) are each introduced once and consumed by name in every later task that needs them (13 in particular) — no renaming drift.
- **Review Focus coverage**: all five items are each assigned to one task's own tests (Tasks 6, 4, 4, 12, 9 respectively), not left floating.
