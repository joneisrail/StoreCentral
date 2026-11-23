# Phase 4a: import products from a channel and map them

Date: 2026-11-23. Status: draft for owner review. Parent: Phase 4 "channel completeness" (`docs/phase-0/02-audit-findings-and-roadmap.md`).

## Phase 4 decomposition

Phase 4 holds four independent pieces. Each gets its own spec, plan and review.

| Sub-project | What | Why this order |
|---|---|---|
| **4a** (this spec) | Preview and import channel products, map to variants | Without it the first sync overwrites the channel; every later piece needs correct links |
| 4b | Sync-status screen in the admin (links, failures, last push, seller-hub down) | Needs 4a's link and problem records to show |
| 4c | Base-price propagation to channels for variants with offers | Independent; small |
| 4d | Amazon go-live (AWS credentials, SQS, per-channel push) | Needs outside setup by the owner; last |

## Intent (assumptions, please correct)

- Who: the store owner who already sells on WooCommerce/Shopify and keeps the catalogue in StoreCentral.
- Goal: connect a channel that already has products and bring them under StoreCentral without losing or overwriting channel data.
- Success: after a connect, the owner can see exactly which channel listings match a variant, which do not, and which clash; can create the missing products in StoreCentral from the channel in one action; and no push to the channel happens until the owner chooses it.

## Current behaviour (read from code)

- `sync/woocommerce-link.ts` and `sync/shopify-link.ts` link listings to variants by exact trimmed SKU and write `seller_hub.channel_listing`. Unmatched and duplicate SKUs are recorded as failed `sync_job` rows (`sync_type='product'`) and returned in `LinkResult`. Nothing creates products.
- Listings without a SKU are dropped silently by `listWooListings`.
- Pushes of price and stock overwrite the channel.

## Design

### Behaviour

1. **Preview (read only).** `GET` through the existing internal API (`internal/connections.ts`, secret protected) returns, for a connection: `matched` (SKU exists in StoreCentral), `unmatched` (channel listing, no variant), `duplicates` (SKU appears more than once on either side), `no_sku` (listing without SKU, with its channel id and title). Nothing is written.
2. **Import.** A POST with the list of unmatched SKUs (or "all") creates, per listing, a StoreCentral product in **draft** status with one variant: title, SKU, price and image URL from the channel, stock quantity as the initial stock level. It then links the new variant exactly as `link` does.
3. **Link only.** The existing link action stays: it links matched SKUs and writes nothing to the channel.
4. **No first push.** Import and link never push to the channel. A pushed value equals the channel's current value anyway for imported items because the variant is created from it.

### Rulings (the recommended choices, taken)

- Matching stays exact trimmed SKU. No fuzzy matching: a wrong match overwrites a real product.
- Imported products are `draft`, never published, so nothing appears on the storefront unreviewed.
- Variable products import each variation as a variant of one product; the parent title becomes the product title. If a parent has a SKU conflict, the whole parent is reported as a duplicate and skipped.
- Listings with no SKU are reported, not imported: the SKU is the only key the sync uses.
- Import is idempotent: a second run skips SKUs that are now linked.
- A per-run cap of 200 listings and a record of each outcome in `sync_job` so a partial failure can be retried.
- Currency: only the store's default currency; a mismatch is reported as skipped (same rule the order importer applies).

### Components

- `apps/seller-hub/src/sync/channel-import.ts`: pure planner `planImport(channelListings, variants)` returning the four groups; unit tested on its own.
- Channel readers: extend `woocommerce/products.ts` and `shopify/products.ts` to return title, image, stock and price, plus no-SKU entries (today dropped).
- `apps/seller-hub/src/medusa/admin-client.ts`: `createDraftProduct(input)` (Medusa admin API, workflow-backed) used by the importer.
- `apps/seller-hub/src/internal/connections.ts`: two routes, `import-preview` and `import`.
- Backend: two proxy routes under `/admin/marketplace-connections/[id]/` and an admin UI panel on the connection page (table of the four groups, "Import selected" button). Dashboard text goes in `en.json`.
- Amazon is out of scope here (4d).

### Error handling

Seller-hub down: the preview route returns the same error shape the connection routes use, and the panel shows it. A failed create records a failed `sync_job` with a sanitized message and continues with the next listing.

### Testing

- Planner: matched, unmatched, duplicate on either side, no-SKU, whitespace and case, empty inputs.
- Importer against the fake Medusa (`test-support/fake-medusa.ts`): creates draft product with right fields, links, is idempotent on rerun, records failure and continues, never calls a channel write method (asserted on the fake channel client).
- Route tests for secret enforcement and the backend proxy; dashboard panel spec for the four groups and the error state.
- Tests use the guarded test database only.

## Not in this spec

Sync-status screen (4b), base-price propagation (4c), Amazon (4d), updating existing StoreCentral products from channel data, deleting anything, image upload into Medusa file storage (the image URL is stored as given).
