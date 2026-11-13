# Shopify Sync — Design

Second marketplace for `apps/seller-hub` (design: `2026-10-15-seller-hub-amazon-sync-design.md`).
StoreCentral stays the master for stock and price; Shopify orders flow in, stock
and price changes flow out. The Amazon half already exists; this adds the
Shopify half beside it and reuses its queues, Medusa client, schema and drift
check. Follow-up pieces (not in this spec): getting Amazon live, an admin
sync-status screen, per-channel pricing.

## Purpose

Keep one inventory correct across StoreCentral and Shopify.

**Intended outcome:** a Shopify sale reduces StoreCentral's available stock; a
stock or price change in StoreCentral appears on Shopify; any difference between
the two is found and corrected by the hourly drift check.

**Explicitly out of scope:**
- Refunds, returns and exchanges from Shopify, and fulfillment status pushed
  back to Shopify.
- Creating products or variants on Shopify (they exist; linking is by SKU).
- Multiple Shopify locations (exactly one Shopify location is mapped).
- Per-channel prices (the single USD variant price is pushed).
- An admin screen for sync status.
- Other marketplaces (eBay, Walmart).

## Decisions carried from brainstorming

- Shopify sync first, then Amazon going live. (Chosen.)
- Shopify variants already exist and are matched to StoreCentral variants by
  SKU. (Chosen: recommended option.)
- The Shopify connector lives inside `apps/seller-hub`, in a new `shopify/`
  folder beside `sp-api/`, with no generic connector layer. (Recommended,
  taken.)

## Architecture

```
apps/seller-hub/src/
  shopify/client.ts            Admin GraphQL client (token, retry on throttle)
  shopify/products.ts          variant lookup by SKU, price update
  shopify/inventory.ts         set available quantity at the mapped location
  shopify/orders.ts            normalize a Shopify order; fetch orders since a time
  shopify/webhook.ts           HMAC verification + route (orders/create, orders/cancelled)
  sync/shopify-link.ts         SKU matching, writes channel_listing rows
  sync/shopify-import-order.ts Shopify order -> Medusa draft order -> order
  sync/shopify-push-inventory.ts, shopify-push-price.ts
  sync/reconcile.ts            (changed) also reconciles the Shopify account
  queue/queues.ts              (changed) shopify-* queue names
  webhook/server.ts            (changed) fan Medusa events out to Shopify queues;
                               add POST /webhooks/shopify
  db/schema.ts                 (changed) additive columns
  index.ts, env.ts             (changed) optional Shopify bootstrap
apps/backend/src/scripts/setup-shopify-channel.ts   link the Shopify channel to
                               the stock location and products (safe to re-run)
```

### Data

Reuse `seller_hub.integration_account` (`marketplace = 'shopify'`) and
`seller_hub.channel_listing` (one row per matched variant, `external_sku` = the
SKU). Additive, idempotent changes in `schema.ts` (same `ADD COLUMN IF NOT
EXISTS` style as the existing file):
- `integration_account`: `shop_domain TEXT`, `access_token_encrypted TEXT`
  (encrypted with the existing `crypto/secret-box.ts`), `shopify_location_id TEXT`.
- `channel_listing`: `external_variant_id TEXT`, `external_inventory_item_id TEXT`
  (Shopify GIDs). `last_synced_quantity` and `last_synced_price` are reused.

### Configuration

Shopify is optional so seller-hub still boots without it. `SHOPIFY_SHOP_DOMAIN`,
`SHOPIFY_ACCESS_TOKEN` (custom-app Admin API token), `SHOPIFY_WEBHOOK_SECRET`
and `SHOPIFY_LOCATION_ID` are read in a separate loader (not added to the
required `SellerHubEnv`). When any is missing, Shopify is skipped and a single
log line says why. The token is stored encrypted in `integration_account`, not
re-read from env after the first connect.

## Behaviour

- **Link (by SKU):** a job lists Shopify variants and matches each to a
  StoreCentral variant with the same SKU. Unmatched and duplicate SKUs are
  recorded on `sync_job` (`last_error`) and skipped; nothing is guessed or
  created. Re-running only adds missing links.
- **Order in:** Shopify `orders/create`, `orders/paid` and `orders/cancelled` webhooks are
  verified against `X-Shopify-Hmac-Sha256` (raw body, constant-time compare,
  401 on mismatch). A paid or authorized order is queued; the import creates a
  draft order in the **Shopify** sales channel with Shopify's unit prices and
  completes it (the Amazon importer's approach). Imports are idempotent on the
  Shopify order id: redelivery or a retry never creates a second order.
  Cancelled orders and unpaid (`pending`) orders are skipped; a pending order is
  deferred until paid. Lines whose SKU has no link make the import fail
  permanently with a clear `last_error` (no partial order).
- **Stock out:** on `inventory-level.updated`, the variant's available quantity
  in StoreCentral is set on Shopify (`inventorySetQuantities`, available) at the
  mapped location. Quantity is clamped at 0.
- **Price out:** on `product-variant.updated`, the USD price is set on the
  Shopify variant.
- **Drift check:** the hourly reconciliation also compares each Shopify
  listing's `last_synced_quantity` and `last_synced_price` with StoreCentral and
  re-queues pushes for differences; it also fetches Shopify orders updated since
  the account's `last_synced_at` and queues any that were missed by webhooks.
  It only ever corrects the Shopify side.
- **Failure handling:** same queue rules as Amazon: 4xx from Shopify (except 429)
  or from Medusa is permanent, others retry with backoff and jitter, throttling
  honours Shopify's retry hint. A Shopify outage never throws into Medusa
  (the existing best-effort subscriber is unchanged).
- **Setup script:** `setup-shopify-channel.ts` links the "Shopify" sales channel
  to Colton Warehouse and to every product (the gap found in the channel
  review), like `setup-amazon-channel.ts`.

## Queues

New names: `shopify-inventory-sync`, `shopify-price-sync`,
`shopify-order-sync`, with their own workers bound to the Shopify
`integration_account`. The Medusa webhook receiver enqueues each Medusa event to
both the Amazon and the Shopify queues (a variant with no listing on a
marketplace is a quiet no-op for that marketplace, not an error).

## Testing

- **Unit (vitest, existing style):** HMAC verification (valid, tampered body,
  wrong secret, missing header); SKU linking (match, unmatched, duplicate);
  Shopify order normalisation (prices, quantities, discounts, taxes excluded
  like Amazon); import idempotency (same order twice -> one order); pending and
  cancelled handling; clamp at 0; price formatting; throttle retry; permanent
  vs retryable classification; env loader with Shopify missing.
- **Integration with a fake Shopify GraphQL server:** end to end for link,
  order import into a fake Medusa admin client, stock push, price push, and a
  reconciliation pass that detects both a stock difference and a missed order.
- **Backend:** the setup script is safe to re-run (second run changes nothing).
- **Before finishing:** build, lint and the full seller-hub and backend unit
  suites; no real Shopify calls are made in tests.

## Open assumptions to confirm

- StoreCentral is the master for stock and price; Shopify edits to either are
  overwritten by the next push or drift check.
- The pushed quantity is StoreCentral's **available** quantity (stocked minus
  reserved) at Colton Warehouse.
- Shopify taxes and shipping are not imported as order lines (as for Amazon).
- A public HTTPS URL for the webhook receiver is needed for real Shopify
  webhooks (a tunnel or deployed host); the drift check's order catch-up covers
  gaps until it exists.
- Known limitation: between a Shopify sale and its import, a stock push could
  overwrite Shopify's own decrement with a stale higher number for a short time
  (a brief oversell window). The import-then-push order and the hourly drift
  check close it quickly; a compare-and-set push is a later hardening step.

## Review Focus

- A redelivered or retried Shopify order never produces a second order.
- A forged or altered webhook body is rejected before anything is queued.
- A Shopify outage or missing Shopify config never breaks Medusa events or the
  Amazon sync.
- An unmatched or duplicate SKU never creates a wrong link or a partial order.
- The drift check only changes the Shopify side and never loops (push -> event
  -> push).
