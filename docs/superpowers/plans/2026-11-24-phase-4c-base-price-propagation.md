# Phase 4c: Base-Price Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a variant's base price changes, connected channels whose offer follows the base price are marked pending and announced, so seller-hub pushes the new price (auto-sync on) or the grid shows the sync icon is needed (auto-sync off).

**Architecture:** A pure selector decides which offers drifted. A workflow `propagate-base-price` runs three steps: find drifted offers (strict connection lookup, same effective-price rule as the push), mark them pending (with compensation), emit one `channel-offer.changed` price event each. The existing `seller-hub-sync` subscriber runs the workflow for `product-variant.updated` when the legacy event would be dropped.

**Tech Stack:** TypeScript, Medusa v2 workflows (`@medusajs/framework/workflows-sdk`, `emitEventStep` from `@medusajs/medusa/core-flows`), jest unit specs in `apps/backend`.

**Spec:** `docs/superpowers/specs/2026-11-24-phase-4c-base-price-propagation-design.md`

## Global Constraints

- Medusa workflow rules: `function` composition (no async, no arrow, no conditionals/`await` in the composer; `when`/`transform` instead); unique `.config({ name })` for repeated steps; mutations only through workflows; imports at file top; zod (if used) from `@medusajs/framework/zod`.
- Only offers with `price` null, on channels that have a seller-hub connection, with `last_synced_price` null or differing from the effective price by 0.005 or more, are touched. Explicit-price offers, stock and `last_synced_*` fields are never modified.
- The effective price comes from the existing `loadPushValues` (`apps/backend/src/api/admin/channel-offers/query.ts`) so it matches what seller-hub would push. The connection set comes from `fetchConnectedChannelIds` (strict: throws when seller-hub cannot answer).
- Events: `channel-offer.changed` with `{ variant_id, sales_channel_id, kind: "price", force: false }` (name constant `CHANNEL_OFFER_CHANGED_EVENT` from `workflows/update-channel-offer.ts`). Never `force: true`, never `manual`.
- The subscriber stays best-effort: a failure is logged with no secret (error name only) and never thrown; legacy forwarding for partly covered variants is unchanged.
- No migration, no seller-hub change, no dashboard change.
- Backend unit tests: `cd apps/backend && TEST_TYPE=unit npx jest --runInBand <path>` (check `apps/backend/package.json` for the exact script/env).

## Review Focus

- A variant whose base price changed but whose only channels are web/POS (no seller-hub connection) must be left completely untouched. Test in Task 1.
- Re-running for the same change (event redelivery) must not mark or emit anything the second time once offers are pending and unchanged is acceptable, but it must never create a second effect on state: marking pending twice is idempotent and emitting twice is coalesced by seller-hub. Test the idempotent mark in Task 2.
- If marking succeeds and a later step fails, the offers' previous `sync_state` must be restored. Test in Task 2.
- A `product-variant.updated` event for a partly covered variant must still be forwarded as the legacy event and must not run the workflow. Test in Task 3.
- A base-price edit on a variant with no offers at all must do nothing and not throw. Test in Tasks 1 and 3.

---

### Task 1: Selector and finder step

**Files:**
- Create: `apps/backend/src/workflows/steps/find-drifted-base-price-offers.ts`
- Test: `apps/backend/src/workflows/steps/__tests__/find-drifted-base-price-offers.unit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OfferDriftInput = { channel_id: string; price: number | null; last_synced_price: number | null; sync_state: string }
  export const PRICE_EPSILON = 0.005
  // Pure: offers that follow the base price (price null), are connected, and drifted.
  export const selectDriftedOffers: (
    offers: OfferDriftInput[],
    effectiveByChannel: Record<string, number>,
    connected: Set<string>
  ) => { channel_id: string; previous_sync_state: string }[]
  export type FindDriftedInput = { variant_id: string }
  export type FindDriftedOutput = { variant_id: string; drifted: { channel_id: string; previous_sync_state: string }[] }
  export const findDriftedBasePriceOffersStep  // createStep("find-drifted-base-price-offers", ...)
  ```
- The step resolves `ContainerRegistrationKeys.QUERY` and `CHANNEL_OFFERS_MODULE`, lists the variant's offers (`offers.listForVariant(variant_id)`), reads the connected set with `fetchConnectedChannelIds()` (let its error propagate), and for each candidate (price null AND connected) calls `loadPushValues({ query, offers, connectedChannelIds: fetchConnectedChannelIds }, variant_id, channel_id)` to get `effective_price`. No offers or no candidates: returns an empty `drifted` list without calling the connection lookup more than once.

- [ ] **Step 1: Write failing tests** `selectDriftedOffers`: `skips offers with an explicit price`, `skips channels without a connection`, `selects when last_synced_price is null`, `selects when difference is 0.005 or more`, `skips when difference is under 0.005`, `empty inputs`; step (container fakes for query/offers, jest-mock `fetchConnectedChannelIds` and `loadPushValues` modules): `returns drifted channels with previous sync state`, `does nothing for a variant with no offers`, `propagates a connection lookup failure`.
- [ ] **Step 2: Run** the new spec file. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `selectDriftedOffers` and the step per the Interfaces text.
- [ ] **Step 4: Run the spec and `npx tsc --noEmit -p apps/backend` filtered to the new files (pre-existing unrelated errors in `integration-tests/http/reviews*.spec.ts` are known).** Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): find offers whose base price drifted`.

### Task 2: Mark step and workflow

**Files:**
- Create: `apps/backend/src/workflows/steps/mark-offers-pending.ts`, `apps/backend/src/workflows/propagate-base-price.ts`
- Test: `apps/backend/src/workflows/steps/__tests__/mark-offers-pending.unit.spec.ts`, `apps/backend/src/workflows/__tests__/propagate-base-price.unit.spec.ts`

**Interfaces:**
- Consumes: `findDriftedBasePriceOffersStep`, `FindDriftedOutput`, `CHANNEL_OFFER_CHANGED_EVENT`.
- Produces:
  ```ts
  export const markOffersPendingStep  // createStep("mark-offers-pending", (input: FindDriftedOutput, { container }) => StepResponse<...>)
  export type PropagateBasePriceInput = { variant_id: string }
  export const propagateBasePriceWorkflow  // createWorkflow("propagate-base-price", ...)
  export default propagateBasePriceWorkflow
  ```
- `markOffersPendingStep`: for each drifted channel call the offers module's `markSync(variant_id, channel_id, { state: "pending" })` (it sets `sync_state: "pending"` and clears `last_error`; touches nothing else). Compensation restores each channel's `previous_sync_state` (use `markSync` for `pending`/`failed` and a direct `updateChannelOffers({ id, sync_state })` via the service for `synced`; look at the service for the existing way and add NO new public method unless unavoidable). Idempotent: marking an already pending offer is a no-op effect.
- Workflow: `findDrifted = findDriftedBasePriceOffersStep(input)`; `markOffersPendingStep(findDrifted)`; `emitEventStep({ eventName: CHANNEL_OFFER_CHANGED_EVENT, data: transform({ findDrifted }, ... => findDrifted.drifted.map(d => ({ variant_id, sales_channel_id: d.channel_id, kind: "price", force: false }))) })` (an array makes `emitEventStep` emit once per element; an empty array emits nothing — confirm in `packages/core/core-flows/src/common/steps/emit-event.ts` and note it in the report); response `{ variant_id, channels: drifted.map(channel_id) }` via `transform`.

- [ ] **Step 1: Write failing tests**: step: `marks only drifted channels pending`, `is idempotent when already pending`, `compensation restores previous states` (call the compensation function directly with the step's output); workflow (follow how `workflows/__tests__/hold-order.unit.spec.ts` or `mark-order-shipped.unit.spec.ts` run workflows with step mocks): `emits one price event per drifted channel with force false`, `emits nothing when nothing drifted`, `a failure after marking triggers compensation`.
- [ ] **Step 2: Run** the two specs. Expected: FAIL.
- [ ] **Step 3: Implement** the step and workflow.
- [ ] **Step 4: Run both specs and Task 1's spec.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): propagate-base-price workflow`.

### Task 3: Subscriber, docs, verification

**Files:**
- Modify: `apps/backend/src/subscribers/seller-hub-sync.ts`, `docs/ops/runbook.md` (short "Base-price changes and channels" section; also remove the stale claim in `docs/superpowers/specs/2026-11-17-channel-pricing-inventory-design.md` rollout note 9 only if it says base edits never propagate: replace with a pointer to the Phase 4c spec)
- Test: extend `apps/backend/src/subscribers/__tests__/seller-hub-sync.unit.spec.ts`

**Interfaces:**
- Consumes: `propagateBasePriceWorkflow`.
- Behaviour: in the handler, for `PRODUCT_VARIANT_UPDATED_EVENT`, when `shouldForwardLegacy(event, container)` is false, run `await propagateBasePriceWorkflow(container).run({ input: { variant_id: event.data.id } })` inside the existing try/catch so a failure is logged with the error name only (`warn`-style message, no secret, no payload) and nothing is thrown; then `return` (no legacy forward). When it is true, behaviour is exactly as before and the workflow is not run. `inventory-level.updated` is unchanged.

- [ ] **Step 1: Write failing tests** (jest-mock the workflow module): `fully covered variant runs the workflow and does not forward the legacy event`, `partly covered variant forwards legacy and does not run the workflow`, `workflow failure is logged by name and not thrown and nothing is forwarded`, `inventory-level.updated behaviour unchanged`, `variant with no offers (not covered) forwards legacy as before`.
- [ ] **Step 2: Run** `seller-hub-sync.unit.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the subscriber change; update the file's header comment where it says price events are not forwarded for covered variants.
- [ ] **Step 4: Run** the subscriber spec plus Tasks 1-2 specs and the existing channel-offers specs (`apps/backend/src/api/admin/channel-offers`, `apps/backend/src/modules/channel-offers`, `apps/backend/src/workflows`, `apps/backend/src/subscribers`). Expected: PASS.
- [ ] **Step 5: Write the runbook section** (what happens after a base-price edit: inheriting channels drift check, pending in the grid, pushed automatically only where auto-sync prices is on, otherwise sync icon; no backfill of earlier edits; web/POS channels never involved) and the rollout-note pointer.
- [ ] **Step 6: Full verification** and report honestly: the backend unit suites above, `npx tsc --noEmit -p apps/backend` (list pre-existing unrelated errors), seller-hub `npx vitest run --exclude src/queue/queues.test.ts` with the vars from `apps/seller-hub/.env` exported except `DATABASE_URL` and `TEST_DATABASE_URL` swapped to `hub_test` (never print it) — seller-hub is unchanged so this only confirms no regression; `node --test deploy/ci-workflow.test.mjs`.
- [ ] **Step 7: Commit** `feat(backend): base-price edits reach connected channels; docs: runbook section`.
