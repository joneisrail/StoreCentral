# @dtc/seller-hub

Seller Hub's Amazon sync engine: a standalone Node service that keeps this
project's Medusa backend and an Amazon Seller Central account in sync —
importing Amazon orders into Medusa, pushing Medusa's inventory/price/product
changes out to Amazon, and periodically reconciling the two so a missed
webhook or notification doesn't cause permanent drift. See
[`docs/superpowers/specs/2026-10-15-seller-hub-amazon-sync-design.md`](../../docs/superpowers/specs/2026-10-15-seller-hub-amazon-sync-design.md)
for the full design (architecture, decisions, and the implementation plan's
task breakdown it was built from).

## Running locally

1. Copy `.env.example` to `.env` and fill in the values:

   | Variable | Purpose |
   | --- | --- |
   | `DATABASE_URL` | Postgres connection string (same instance/database as the Medusa backend; this service owns its own `seller_hub` schema within it) |
   | `REDIS_URL` | Redis connection used by the BullMQ job queues |
   | `MEDUSA_BACKEND_URL` | Base URL of the Medusa backend, no trailing slash |
   | `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD` | Medusa admin user this service authenticates as |
   | `ENCRYPTION_KEY` | 32-byte hex key used to encrypt the stored Amazon LWA refresh token |
   | `AWS_REGION` | AWS region for the SQS queue |
   | `SQS_QUEUE_URL` | SQS queue that receives Amazon's SP-API order-change notifications |
   | `AMAZON_LWA_CLIENT_ID` / `AMAZON_LWA_CLIENT_SECRET` | Login-with-Amazon credentials for the SP-API application |

2. Make sure Postgres, Redis, and the Medusa backend are running, and that
   the Medusa backend's own `.env` has `SELLER_HUB_WEBHOOK_URL` pointing at
   this service's webhook port (`http://localhost:7005` by default — see
   `WEBHOOK_PORT` below).

3. Start the service:

   ```bash
   yarn workspace @dtc/seller-hub dev
   ```

   On boot it applies the `seller_hub` schema's migrations, starts the four
   BullMQ sync queues/workers (order, inventory, price, product), starts the
   webhook server that receives Medusa's inventory/price change events,
   starts the SQS consumer that polls for Amazon order-change notifications,
   and schedules hourly reconciliation.

   `WEBHOOK_PORT` (optional, defaults to `7005`) overrides the port the
   webhook server binds to, without widening `SellerHubEnv`'s required
   variables for a purely local bind-address concern.

## External prerequisites not yet in place

Two things from the design spec's Open Items are genuine external
prerequisites, outside this repo's control, and are **not** set up yet. Until
both are done, the service boots and stays up (see below), but every
Amazon-facing call fails against a placeholder/absent credential rather than
succeeding for real:

- **AWS account and SQS queue.** `SQS_QUEUE_URL` in `.env` is currently a
  placeholder. The SQS consumer logs `receiveMessage` failures against it on
  every poll — expected, and non-fatal, but it means no real Amazon order
  notification can arrive until a real SQS queue (subscribed to Amazon's
  `ORDER_CHANGE` notifications) exists and `SQS_QUEUE_URL`/`AWS_REGION` point
  at it.
- **Amazon SP-API app registration / professional seller account approval.**
  `AMAZON_LWA_CLIENT_ID`/`AMAZON_LWA_CLIENT_SECRET` are placeholders, and no
  Amazon refresh token has been connected yet (`seller_hub.integration_account`
  starts `disconnected`). This has its own external approval timeline and is
  worth starting early.

Both need to be resolved before Task 13's manual smoke checklist (an
end-to-end pass against Amazon's real sandbox/test seller account for order
import, inventory push, price push, and product listing) can run for real.

## Shopify

The same service can also sync a Shopify store (optional). It starts only when
all four variables below are set; otherwise boot logs one line and skips it.

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_SHOP_DOMAIN` | e.g. `your-shop.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Admin API access token of a custom app |
| `SHOPIFY_WEBHOOK_SECRET` | The app's webhook signing secret (verifies `X-Shopify-Hmac-Sha256`) |
| `SHOPIFY_LOCATION_ID` | GraphQL id of the Shopify location that holds stock, `gid://shopify/Location/...` |

**Custom-app scopes:** read and write products, inventory and orders
(`read_products`, `write_products`, `read_inventory`, `write_inventory`,
`read_orders`, `write_orders`). Add `read_all_orders` if orders older than 60
days must be readable.

**StoreCentral is the stock and price master.** Quantities and prices are
pushed from Medusa to Shopify, and edits made in Shopify are overwritten on the
next sync or drift check. Variants are linked by exact SKU at boot; unmatched
and duplicate SKUs are not linked and are recorded as failed `product` sync jobs.

**First sync overwrites Shopify.** Right after variants are linked, the next
drift check (hourly) pushes StoreCentral's stock and price for every newly
linked listing to Shopify, overwriting whatever Shopify had.

**Setup**

1. Create the "Shopify" sales channel in Medusa (links it to the stock
   location(s) and every product; safe to re-run). From `apps/backend`:
   `npx medusa exec ./src/scripts/setup-shopify-channel.ts`
2. Set the variables above and restart seller-hub.
3. Shopify can only deliver webhooks to a public HTTPS URL, so expose the
   webhook port (`WEBHOOK_PORT`, default 7005) and register
   `https://<public-host>/webhooks/shopify` for the topics `orders/create`,
   `orders/paid` and `orders/cancelled`. Without it (for example on a dev
   machine), the hourly drift check catches up orders updated since its last
   clean scan instead.

**API version:** pinned to `2026-10` in `src/shopify/client.ts`. The GraphQL
field names used have not yet been verified against a real shop; do that
before relying on it.

**Known limitation:** there is a brief oversell window between a sale on
Shopify and its import into Medusa (webhook or drift check), during which
Medusa's stock has not yet been decremented.

## WooCommerce (WordPress)

The same service can also sync a WooCommerce store (optional). It starts only
when all four variables below are set; otherwise boot logs one line and skips it.

| Variable | Purpose |
| --- | --- |
| `WOOCOMMERCE_SITE_URL` | e.g. `https://your-store.example.com` (**https only**; anything else disables the connector) |
| `WOOCOMMERCE_CONSUMER_KEY` | REST API consumer key (`ck_...`) |
| `WOOCOMMERCE_CONSUMER_SECRET` | REST API consumer secret (`cs_...`) |
| `WOOCOMMERCE_WEBHOOK_SECRET` | Secret you set on the WooCommerce webhooks (verifies `X-WC-Webhook-Signature`) |

**Create a REST API key:** WooCommerce -> Settings -> Advanced -> REST API ->
Add key, with **Read/Write** permission.

**StoreCentral is the stock and price master.** Quantities and regular prices
are pushed from Medusa to WooCommerce, and edits made in WooCommerce are
overwritten on the next sync or drift check. Sale prices are never touched.
Listings are linked by exact SKU at boot; unmatched and duplicate SKUs are not
linked and are recorded as failed `product` sync jobs.

**First sync overwrites WooCommerce.** Right after listings are linked, the next
drift check (hourly) pushes StoreCentral's stock and regular price for every
newly linked listing to WooCommerce, overwriting whatever it had, and turns on
stock management for each linked product.

**Setup**

1. Create the "WordPress" sales channel in Medusa (links it to the stock
   location(s) and every product; safe to re-run). From `apps/backend`:
   `npx medusa exec ./src/scripts/setup-woocommerce-channel.ts`
2. Create the REST API key and set the variables above, then restart seller-hub.
3. WooCommerce can only deliver webhooks to a public HTTPS URL, so expose the
   webhook port (`WEBHOOK_PORT`, default 7005) and create two webhooks under
   WooCommerce -> Settings -> Advanced -> Webhooks, topics `Order created` and
   `Order updated`, delivery URL `https://<public-host>/webhooks/woocommerce`,
   and the same secret as `WOOCOMMERCE_WEBHOOK_SECRET`. Without a public URL (for
   example on a dev machine), the hourly drift check's order catch-up imports
   orders modified since its last clean scan instead.

**Known limitations**

- Orders that are pending, on-hold or failed are re-checked every 30 minutes
  until they are paid.
- A cancelled order that is later re-opened in WooCommerce is NOT imported.
- Refunds and returns are not synced.
- Variable product parents are not linked; only simple products and variations.
- The WooCommerce REST field names used have not been verified against a real
  store; do that before relying on it.
- There is a brief oversell window between a sale on WooCommerce and its import
  into Medusa (webhook or drift check), during which Medusa's stock has not yet
  been decremented.

## Managing connections from the admin

Shopify and WooCommerce can be connected, changed and disconnected from the
**Marketplace connections** page in the Medusa admin (built in a later task),
without editing env files or restarting this service. Saving a connection tests
the credentials first, then applies them live: the webhook server and workers
switch over immediately.

- **Internal secret.** The admin talks to this service through an internal API
  that is authenticated with a shared secret. Set the same
  `SELLER_HUB_INTERNAL_SECRET` in both seller-hub and the backend, and set
  `SELLER_HUB_INTERNAL_URL` in the backend to this service's address. The secret must be at
  least 16 characters (after trimming). When it is unset or too short here, the internal API is disabled and `/internal/*` returns
  404.
- **Public URL.** Set `SELLER_HUB_PUBLIC_URL` (for example
  `https://hub.example.com`) so the admin can show the webhook URLs to register
  in Shopify and WooCommerce. It is only used for display.
- **Env variables are a fallback.** `SHOPIFY_*` and `WOOCOMMERCE_*` still work
  exactly as before. A connection saved from the admin takes precedence over
  them.
- **Disconnecting.** Disconnect stops the connector and clears the stored
  credentials. If the env variables are still set, the connector reconnects from
  them on the next restart; remove them to stay disconnected.
- **Network exposure.** The internal API must be reachable only from the
  backend (private network or firewall rule). Do not expose `/internal/*`
  publicly; only `/webhooks/*` needs to be reachable from the internet.
- **Amazon is read-only for now.** The page shows Amazon's status but it cannot
  be connected or changed there yet.
