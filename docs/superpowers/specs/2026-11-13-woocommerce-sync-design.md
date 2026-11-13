# WooCommerce (WordPress) Sync — Design

Third marketplace for `apps/seller-hub`, after Amazon and Shopify
(`2026-10-15-seller-hub-amazon-sync-design.md`, `2026-11-13-shopify-sync-design.md`).
The target is the WooCommerce store at ai-fragrance.com. StoreCentral stays the
master for stock and price; WooCommerce orders flow in, stock and price changes
flow out. Medusa has no WordPress or WooCommerce module, so this is a custom
connector against the WooCommerce REST API (v3), following the Shopify pattern.

## Purpose

Keep one inventory correct across StoreCentral and the WooCommerce store.

**Intended outcome:** a WooCommerce sale reduces StoreCentral's available stock;
a stock or price change in StoreCentral appears on WooCommerce; any difference is
found and corrected by the hourly drift check.

**Explicitly out of scope:**
- Refunds, returns and exchanges, and order status pushed back to WooCommerce.
- Creating products or variations in WooCommerce (they exist; linking is by SKU).
- Sale prices, tiered prices, tax settings, and currencies other than USD.
- An admin screen for sync status.
- Any other WordPress plugin (Klaviyo, Pinterest, PayPal, etc.).
- Writing to the live site during development; tests use a fake WooCommerce.

## Decisions carried from brainstorming

- WooCommerce at ai-fragrance.com is the target (WooCommerce is active on the
  connected WordPress site). (Confirmed.)
- Products already exist in WooCommerce and are matched to StoreCentral variants
  by exact SKU. (Chosen: recommended option.)
- The connector lives inside `apps/seller-hub` in a new `woocommerce/` folder
  beside `shopify/` and `sp-api/`, with no shared connector layer yet; shared
  pieces are reused where they already exist. (Recommended, taken.)
- The new sales channel is named **WordPress**. (Assumption, see below.)

## Architecture

```
apps/seller-hub/src/
  woocommerce/config.ts        optional env loader (null when unconfigured)
  woocommerce/account.ts       find-or-create the integration_account row
  woocommerce/client.ts        REST client (Basic auth over HTTPS, retry, pagination)
  woocommerce/products.ts      list products + variations, set stock, set price
  woocommerce/orders.ts        normalize an order; fetch one; fetch modified since
  woocommerce/webhook.ts       signature verification
  woocommerce/bootstrap.ts     optional startup (queues, workers, schedule)
  sync/woocommerce-link.ts     SKU matching, writes channel_listing rows
  sync/woocommerce-push-inventory.ts, woocommerce-push-price.ts
  sync/woocommerce-import-order.ts, woocommerce-order-sync-processor.ts
  sync/reconcile.ts            (changed) WooCommerce drift + missed orders
  queue/queues.ts              (changed) woocommerce-* queue names
  webhook/server.ts            (changed) POST /webhooks/woocommerce; fan Medusa events out
  db/schema.ts                 (changed) additive columns
  index.ts                     (changed) optional WooCommerce bootstrap
apps/backend/src/scripts/setup-woocommerce-channel.ts   create the WordPress
                               sales channel, link it to the stock location(s)
                               and every product (safe to re-run, not run in dev)
```

The order-import flow reuses the existing generic claimed-import flow
(`OrderImportAdapter` in `sync/import-order.ts`, added for Shopify) with a
WooCommerce adapter; the Amazon and Shopify behaviour and tests must not change.
The drift check reuses `reconcileShopify`'s logic by extracting the shared part
if it can be done without changing Shopify's behaviour or tests; otherwise a
WooCommerce twin is written and the duplication is noted for a later cleanup.

### Data

Reuse `seller_hub.integration_account` (`marketplace = 'woocommerce'`) and
`seller_hub.channel_listing`. Additive, idempotent changes in `schema.ts`:
- `integration_account`: `api_key TEXT` (the consumer key). The existing
  `shop_domain` holds the site base URL and `access_token_encrypted` holds the
  consumer secret, encrypted with `crypto/secret-box.ts`.
- `channel_listing`: `external_parent_id TEXT` (the parent product id for a
  variation, NULL for a simple product). The existing `external_variant_id`
  holds the WooCommerce product or variation id; `external_inventory_item_id`
  stays unused. `last_synced_quantity` and `last_synced_price` are reused.

### Configuration

WooCommerce is optional so seller-hub boots without it. `WOOCOMMERCE_SITE_URL`,
`WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` and
`WOOCOMMERCE_WEBHOOK_SECRET` are read by a separate loader (not added to the
required `SellerHubEnv`). When any is missing or empty, WooCommerce is skipped
with one log line. The site URL must be `https://`; anything else is rejected at
load time (credentials are never sent over plain HTTP). Keys and secrets are
never logged.

## Behaviour

- **Link (by SKU):** WooCommerce products (and the variations of variable
  products) are listed with their SKUs and matched to StoreCentral variants with
  the same SKU (trimmed, case-sensitive exact). A variation links at the
  variation level. Unmatched and duplicate SKUs are recorded on `sync_job` and
  skipped; nothing is guessed. Re-running only adds missing links. The link runs
  at startup, log-only on failure.
- **Order in:** WooCommerce webhooks `order.created` and `order.updated` are
  verified against `X-WC-Webhook-Signature` (base64 HMAC-SHA256 of the raw body
  with the webhook secret, constant-time compare, 401 on mismatch) before
  anything is parsed or queued. WooCommerce also sends a form-encoded "ping" on
  webhook creation; a correctly signed ping is acknowledged with 200 and ignored.
  A valid delivery is queued as `{ wooOrderId }` on the order queue with the job
  id `woocommerce-order-<id>` (not an integer, which BullMQ rejects),
  `removeOnComplete` and `removeOnFail` true. Import creates a draft order in the
  **WordPress** sales channel with the WooCommerce unit prices (line `total`
  after discounts, tax excluded, divided by quantity, rounded to a cent) and
  completes it. Imports are idempotent on the WooCommerce order id.
  Status handling: `processing` and `completed` import; `pending` and `on-hold`
  are deferred (`DeferSyncError`) until paid; `cancelled`, `refunded` and `failed`
  (and `trash`) are skipped. A non-USD order, an order with an unmatched SKU, or
  a line with no SKU fails permanently with a clear `last_error` and creates no
  draft or order.
- **Stock out:** on `inventory-level.updated`, the variant's available quantity
  in StoreCentral is set on the WooCommerce product or variation
  (`manage_stock: true`, `stock_quantity`), clamped at 0 and floored to an
  integer.
- **Price out:** on `product-variant.updated`, the USD price is set as the
  WooCommerce `regular_price` (a 2-decimal string). Sale prices are untouched.
- **Drift check:** the hourly reconciliation compares each WooCommerce
  listing's `last_synced_quantity` and `last_synced_price` (the price after any
  price rule, as for Amazon and Shopify) with StoreCentral, re-queues pushes for
  differences, pushes newly linked listings (NULL baseline counts as drift), and
  fetches orders modified since the account's `last_synced_at` (24 hours back
  when null; `modified_after`) and queues any missed ones. The order watermark
  advances whenever the order catch-up succeeded. It only ever corrects the
  WooCommerce side.
- **Failure handling:** same rules as Shopify: a 4xx (except 429) is permanent,
  429 and 5xx and network errors retry with backoff; a WooCommerce outage or a
  failed startup never breaks Medusa events or the Amazon and Shopify syncs.
  Unknown webhook topics are acknowledged with 200 (WooCommerce disables a
  webhook after repeated non-2xx responses, so only genuine enqueue failures
  return 5xx).
- **Setup script:** creates the WordPress sales channel, links it to the stock
  location(s) and every product, safe to re-run. It is not run during
  development.

## Queues

New names: `woocommerce-inventory-sync`, `woocommerce-price-sync`,
`woocommerce-order-sync`, with their own workers bound to the WooCommerce
`integration_account`. The WooCommerce reconcile job runs on the WooCommerce
inventory queue only and is routed by job name there, so the Amazon and Shopify
workers never receive it. The Medusa webhook receiver enqueues each Medusa event
to the Amazon, Shopify and WooCommerce queues, each independent of the others.

## Testing

- **Unit (vitest, existing style):** signature verification (valid, tampered
  body, wrong secret, missing header, ping); SKU linking (simple, variation,
  unmatched, duplicate, whitespace); order normalisation (unit price from line
  total, tax excluded, missing SKU, non-USD); status handling; import
  idempotency (same order twice -> one order); clamp at 0; price formatting;
  retry and permanent-error classification; https-only config; env loader with
  WooCommerce missing; drift including the NULL baseline and price-rule cases;
  order watermark behaviour.
- **Integration with a fake WooCommerce REST server:** end to end for link, a
  signed order webhook into a fake Medusa admin client, stock push, price push,
  a forged webhook, a ping, and a reconcile pass that finds a stock difference
  and a missed order; startup isolation when WooCommerce fails to start.
- **Regression:** every existing Amazon and Shopify test passes unchanged.
- **Before finishing:** build, lint and the full seller-hub suite; backend type
  check for the new script. No real calls to ai-fragrance.com.

## Open assumptions to confirm

- The sales channel is named **WordPress** (not "WooCommerce").
- Pushing stock sets `manage_stock: true` on the WooCommerce product or
  variation, changing that product's stock setting.
- StoreCentral overwrites WooCommerce's stock and regular price; edits made in
  WooCommerce are replaced by the next push or drift check, and the first sync
  overwrites everything linked.
- WooCommerce webhooks need a public HTTPS address for StoreCentral; until it
  exists, the drift check's order catch-up covers gaps.
- Known limitation: between a WooCommerce sale and its import, a stock push can
  briefly overwrite WooCommerce's own decrement with a stale number.
- The WooCommerce field names (`line_items[].total`, `date_modified_gmt`,
  `manage_stock`, `stock_quantity`, `regular_price`) come from the v3 REST API
  and are checked only against a fake until tried on a real store.

## Review Focus

- A redelivered or retried WooCommerce order never creates a second order.
- A forged or altered webhook is rejected before anything is parsed or queued;
  a signed ping does not break the endpoint.
- A WooCommerce outage, bad config or failed startup never breaks Medusa events,
  Amazon or Shopify.
- An unmatched or duplicate SKU never creates a wrong link or a partial order.
- Drift correction only changes the WooCommerce side and never loops.
- Credentials are never sent over plain HTTP and never logged.
