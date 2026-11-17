# Per-channel pricing and inventory

Builds on the marketplace connections (sales channel <-> connection via
`integration_account.medusa_sales_channel_id`), the purchase receipt workflow
and the seller-hub push workers. A throwaway interactive mockup of the grid was
reviewed with the owner (search, sort, hover edit, sync icon).

## What exists today (checked in the code)

- Every channel gets the variant's single Medusa price and single Medusa
  available stock. Seller-hub pushes them per listing (`shopify-push-price`,
  `shopify-push-inventory`, WooCommerce and Amazon equivalents; a `price_rule`
  can adjust the price). `channel_listing` keeps `last_synced_price` and
  `last_synced_quantity`.
- Pushes are triggered by the backend subscriber `seller-hub-sync.ts`, which
  forwards `inventory-level.updated` and `product-variant.updated` to seller-hub.
- Seller-hub reads stock with `getVariantInventory(variantId)` (Medusa
  `inventory_quantity`, one number per variant).
- Receiving a purchase adds stock to one stock location (`record-purchase-receipt`,
  `ensure-inventory-levels`) and knows nothing about channels.
- Medusa prices are per currency/region/customer group, never per sales channel.

## Purpose

The owner sets a price and a stock number **per sales channel** for each variant,
edits them in a grid, pushes them to a marketplace on demand, and received
stock is shared equally across channels.

**Intended outcome:** open "Channel stock & pricing", see one price and one
stock per channel for every variant, edit a cell in place, press the sync icon
to update Shopify/WooCommerce/Amazon, and when a purchase is received every
channel gets an equal share.

## Decisions (owner-confirmed)

- **Separate stock per channel** (not a shared pool). A sale on a channel lowers
  only that channel, unless the store-wide switch below is on.
- **Switch "Share stock across channels after a sale"**, store-wide, default off.
  When on, after a sale the combined remaining channel stock is re-split equally.
- **Web store and POS are channels** like the marketplaces (they have no
  connection, so no sync icon).
- **Receiving a purchase:** the received quantity splits equally across **all**
  channels; odd units go one at a time to the first channels in a fixed order
  (channel creation order).
- **Existing stock:** a one-time script splits each variant's current stock
  equally across the channels; nothing is pushed to marketplaces by it.
- **Sync policy (mixed):** stock changes from orders and received purchases push
  automatically (coalesced); price edits and manual stock edits wait for the sync
  icon. A per-connection "auto-sync prices" switch makes prices automatic too.
- **Architecture B:** a new table for channel price/stock; Medusa's available
  stock stays the physical total.

## Data model (new module `channel-offers`)

- `channel_offer { id, variant_id, sales_channel_id, price (numeric, nullable;
  null = use the variant's base price), stock (int >= 0), last_synced_price,
  last_synced_stock, last_synced_at, sync_state ("synced" | "pending" |
  "failed"), last_error }`, unique (`variant_id`, `sales_channel_id`). No links to
  other modules (plain ids).
- `channel_stock_movement { id, kind ("order" | "cancel" | "receipt" |
  "edit" | "rebalance" | "trim"), variant_id, sales_channel_id, delta, ref
  (order line id / receipt id / ...), created_at }`, unique (`kind`, `ref`,
  `variant_id`, `sales_channel_id`) for the kinds that carry a ref, so a
  repeated event never applies twice. It doubles as the stock history.
- Settings: `share_stock_after_sale` (boolean, store-wide, default false), stored
  with the other order-page settings; `auto_sync_price` (boolean) per marketplace
  connection (seller-hub `integration_account`).
- Rows exist for every variant and channel: created on variant creation and on
  channel creation (stock 0, price null). A new channel starts at 0 and does not
  take stock from other channels.

## Rules

- **Invariant:** the sum of a variant's channel stock never exceeds Medusa's
  available stock; the difference is shown as "unallocated". A grid edit that
  would exceed it is rejected with the number of free units.
- **Order placed** on channel X for quantity q: X.stock = max(0, X.stock - q).
  With the switch on, the combined channel stock is then re-split equally.
  **Order cancelled:** the quantity is added back to the channel the order came
  from (same re-split rule). Applied once per order line (movement ref).
- **Purchase received:** a final step in the receipt workflow splits the received
  quantity equally across all channels (rule above).
- **Total changes from other causes** (manual adjustment, damage, cancelled
  purchase) that make the sum exceed available stock: channels are trimmed,
  largest channel first, and a `trim` movement is recorded. Increases stay
  unallocated until assigned.
- **Prices:** `price` null means the variant's base price (store currency). The
  web store and POS always show Medusa's base price, read-only in the grid;
  checkout, cart prices and stock checks are unchanged in this slice (see
  Deferred).
- **All mutations run as workflows**, per-variant lock (Medusa locking module,
  as the receipt step does).

## API (admin, workflows behind each POST)

- `GET /admin/channel-offers?q&order&limit&offset&channel_ids` -> grid rows:
  variant, product title, SKU, base price, available stock, unallocated, and per
  channel `{ price, stock, sync_state, last_synced_at, last_error }`. Search by
  product title or SKU; sort by name, total, unallocated, or any channel's stock
  or price; server-side paging.
- `POST /admin/channel-offers/:variant_id/:channel_id` `{ price?, stock? }` ->
  edit one cell; marks it pending.
- `POST /admin/channel-offers/:variant_id/:channel_id/sync` -> asks seller-hub to
  push that channel's price and stock now (no-op with a clear message for
  channels without a connection).
- `GET/POST /admin/channel-stock-settings` `{ share_stock_after_sale }`.
- One-time `src/scripts/split-existing-stock.ts` (run with `medusa exec`),
  idempotent, never run against a database by the build.

## Sync to marketplaces

- The backend subscriber stops forwarding variant-level inventory/price events
  for variants that have channel offers; it forwards a per-channel event
  `{ variant_id, sales_channel_id, kind: "stock" | "price" | "both", force? }`
  instead (also from the sync route).
- Seller-hub resolves the connection by `medusa_sales_channel_id`, enqueues one
  push on that connection's queue (jobId per variant/channel/kind so repeats
  coalesce), and the push reads the channel's own price and stock from a new
  backend read route (replacing `getVariantInventory` and the base price) before
  applying the connection's `price_rule`. No offer row -> nothing is pushed for
  stock; price falls back to base.
- Stock events are forwarded automatically; price is forwarded only from the sync
  icon, or automatically when the connection's `auto_sync_price` is on.
- Success updates `last_synced_*` and `sync_state`; a permanent failure sets
  `failed` with a message (no secrets) and the existing `sync_job` records
  remain. A seller-hub outage is logged and dropped as today; the cell stays
  pending until a sync succeeds.

## Dashboard

- New page "Channel stock & pricing" in the products area, built on the shared
  tab-table pieces (search, sort, paging). Channel columns come from the sales
  channels, with chips to show or hide channels.
- Cell: pencil on hover, Enter saves, Esc cancels; edited cells are amber with
  the previous value struck through; per-cell sync icon only for channels with a
  connection ("live" for web store and POS); red state with the message and a
  retry on failure; "not listed" when a variant has no marketplace listing.
- Row shows total and unallocated stock.
- The shared-stock switch in the sales channel settings; the auto-sync-prices
  switch in the channel page's "Marketplace connection" section.

## Error handling

- Over-allocation, negative or non-numeric values: rejected with a message.
- Marketplace rejection: failed state with message; the change stays saved.
- Rebalancing never produces negative stock; a failed workflow step compensates
  (stock rows restored).
- Event redelivery is harmless (movement refs).

## Testing

- **Backend unit/integration:** equal split with remainders, the switch on and
  off, never below zero, idempotent order/cancel events, trim on total decrease,
  receipt split, over-allocation rejection, grid search/sort/paging, routes and
  auth, the one-time split on a temporary database.
- **Seller-hub:** the push reads per-channel values, connection mapping,
  coalescing, failure marking, `price_rule` still applied, no secrets in logs.
- **Dashboard:** edit/cancel/amber state, sync, sort, search, channel columns.
- **Regression:** order slices A-C, existing price/stock sync, receipt tests.

## Delivery (one spec, one branch, three phases)

1. Module, rules, order and receipt hooks, API, settings, one-time split script.
2. The grid page.
3. Seller-hub per-channel push and the sync icon.

## Deferred

- Web store/POS with their own prices or hard stock limits (needs Medusa cart
  pricing and inventory-check changes).
- Per-channel price rules (markups), sale-price dates, reports by channel.
- Returns restoring channel stock; per-product override of the shared-stock
  switch; per-channel share percentages.

## Review focus

- The sum of channel stock never exceeds available stock; no negative stock.
- An order or event applied twice changes stock once.
- Each marketplace is sent only its own channel's price and stock, never another
  channel's.
- A marketplace or seller-hub outage never fails a Medusa action.
- Existing order, receipt and sync behaviour is unchanged.

## Rollout

Run in this order. Nothing here pushes anything to a marketplace by itself.

1. From `apps/backend`: `npx medusa db:migrate` (creates `channel_offer` and `channel_stock_movement`).
2. Restart the backend and seller-hub. Seller-hub adds `integration_account.auto_sync_price` by itself at startup (`ADD COLUMN IF NOT EXISTS`).
3. One-time split of existing stock, first as a dry run (the default; it only counts):
   `npx medusa exec ./src/scripts/split-existing-stock.ts`
4. Then, in a quiet period (no orders or stock edits in flight), apply it. The word `apply` must be positional:
   `npx medusa exec ./src/scripts/split-existing-stock.ts apply`
   Safe to re-run; a variant that already has channel stock is left alone.
5. The script emits no events and pushes nothing. To get values onto a marketplace, press the channel's sync icon (forces price and stock), or wait for the next stock change (stock auto-pushes; price only if the connection has auto sync price on).
6. The web store and POS keep reading the variant base prices; only marketplaces get channel prices.
7. The grid lives at `/app/products/channel-pricing`.
8. Run `split-existing-stock.ts apply` immediately after the migration, before any receipts or grid edits, in a quiet period: until a variant is split, only the legacy variant-level forward keeps other channels updated.
9. Base-price edits made in Medusa do NOT propagate to marketplaces for variants with channel offers: use the grid's sync icon (auto sync price does not cover base price changes).

## Open assumptions

- Orders placed by seller-hub carry the channel's sales channel id; the plan's
  first backend task proves it (and where order placement and cancellation are
  read) with a failing test.
- The receipt workflow's final step can read the receipt lines and variants; the
  plan verifies the exact hook point.
