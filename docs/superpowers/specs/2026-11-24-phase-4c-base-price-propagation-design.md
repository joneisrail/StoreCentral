# Phase 4c: base-price changes reach the channels that use the base price

Date: 2026-11-24. Status: draft for owner review. Parent: Phase 4 "channel completeness" (see `2026-11-23-phase-4a-channel-product-import-design.md` for the four sub-projects).

## Intent (assumptions, please correct)

- Who: the store owner, who edits a variant's base price in the Medusa admin.
- Problem: a channel offer with no price of its own (`price` = null, "use base price") should follow the base price. Today it does not: when a variant has an offer row for every sales channel, the legacy `product-variant.updated` event is dropped (`apps/backend/src/subscribers/seller-hub-sync.ts`, `shouldForwardLegacy`), and nothing replaces it. The grid still says "synced" because a null channel price counts as in sync. The channel keeps the old price until someone presses the sync icon. The Phase 0 audit lists this as missing item 5.
- Success: after a base-price edit, every channel whose offer follows the base price is (a) shown as pending in the grid if its last pushed price differs, and (b) pushed automatically when that connection has "auto-sync prices" on, or on the sync icon when it is off. Channels with their own explicit price never change. No push happens when the price did not change.
- This matches the rule already approved in the channel pricing spec: prices are pushed automatically only for connections with auto-sync prices on; otherwise they wait for the sync icon.

## Current behaviour (read from code)

- `channel_offer` rows: `price` (null = base), `last_synced_price`, `sync_state` (synced / pending / failed). The sync-state derivation in `modules/channel-offers/service.ts` treats `price === null` as price-OK, so a base change never makes an offer pending.
- Subscriber `seller-hub-sync.ts` forwards `channel-offer.changed` `{ variant_id, sales_channel_id, kind, force, manual? }` as is. Seller-hub decides: stock always, price only when `force` or the connection's `auto_sync_price` is on (`apps/seller-hub/src/sync/auto-sync-price.ts`).
- `loadPushValues` (`api/admin/channel-offers/query.ts`) computes the effective price a push would send for a (variant, channel): explicit offer price, else base price, in the store currency.

## Design

### New workflow `propagate-base-price` (backend)

Input: `{ variant_id }`. Steps:

1. **Find inheriting offers.** List the variant's `channel_offer` rows with `price` null.
2. **Compare.** For each, read the effective price with the existing `loadPushValues` logic (same code the push uses, so the comparison matches what would be pushed). Keep offers where `last_synced_price` is null or differs from the effective price by 0.005 or more.
3. **Mark pending.** Set `sync_state = "pending"` on those offers (nothing else changes; stock and explicit prices untouched). Compensation restores the previous `sync_state`.
4. **Announce.** Emit one `channel-offer.changed` per kept offer: `{ variant_id, sales_channel_id, kind: "price", force: false }`. Seller-hub then applies its existing rule (auto-sync on: push; off: wait for the sync icon).

Offers whose `price` is non-null are never touched. A variant with no offers returns without doing anything.

### Subscriber change

In `seller-hub-sync.ts`, for `product-variant.updated`: when `shouldForwardLegacy` says the legacy event is dropped (variant fully covered by offers), run `propagate-base-price` for that variant instead of returning silently. When the legacy event is still forwarded (partly covered), behaviour is unchanged. The subscriber stays best-effort: a failure is logged without a secret and never thrown.

Event redelivery is harmless: the second run finds `sync_state` already pending and re-emits at most one coalesced push per (variant, channel), because seller-hub already coalesces by job id.

### Rulings (recommended choices, taken)

- Reuse the push's own effective-price computation; do not recompute prices in a second place.
- Only inheriting offers are considered; no change to explicit prices.
- `force` stays false: a base-price edit must respect each connection's auto-sync switch, exactly like an explicit channel-price edit does.
- A channel that is not connected is still marked pending (the grid shows it needs a sync), but seller-hub drops the event for it, as today.
- No retroactive backfill: only edits made after deploy propagate. Existing drift is fixed with the sync icon.

### Testing

- Unit: the compare-and-select function (null last price, equal within 0.005, different, explicit price skipped, no offers).
- Workflow integration spec (backend HTTP/integration style used by the other channel workflows): base-price edit marks only inheriting, drifted offers pending, emits one event each with `force: false`, and the compensation restores `sync_state`.
- Subscriber spec: fully covered variant runs the workflow and does not forward the legacy event; partly covered variant forwards legacy and does not run it; a workflow failure is logged and not thrown.
- Verification repeats the Phase 4a/4b suites; nothing in seller-hub changes.

## Not in this spec

Pushing prices for channels without an offer row, a per-channel "follow base price" switch, price rules, currency conversion, backfilling existing drift, any dashboard change (the grid already renders `sync_state`).
