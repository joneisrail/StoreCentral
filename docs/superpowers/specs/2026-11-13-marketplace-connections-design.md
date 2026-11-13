# Marketplace Connections — Design

Sits on top of the Amazon, Shopify and WooCommerce connectors in `apps/seller-hub`
(`2026-10-15-seller-hub-amazon-sync-design.md`, `2026-11-13-shopify-sync-design.md`,
`2026-11-13-woocommerce-sync-design.md`). Today each connector reads its
credentials from seller-hub env variables at startup. This adds an admin screen
where the store owner connects a marketplace to a sales channel, with credentials
stored encrypted in StoreCentral and applied live.

## Purpose

Let the owner add and manage marketplace connections from the Medusa admin
instead of editing env files and restarting a service.

**Intended outcome:** the owner opens "Marketplace connections", enters the
Shopify or WordPress credentials, picks the sales channel, and presses Save. The
connection is tested, stored encrypted, and started without restarting
seller-hub; orders, price and inventory then sync for that channel as before.

**Explicitly out of scope:**
- More than one connection per marketplace (several Shopify stores, etc.).
- Editing Amazon from the admin. Its client is built once at startup from env
  and AWS settings; making that live belongs with the "Amazon going live" piece.
  The Amazon card is read-only (status only).
- eBay, Walmart, or any other marketplace.
- Changing how orders, stock or price sync. Only where credentials come from.
- Replacing the setup scripts (`setup-shopify-channel.ts`,
  `setup-woocommerce-channel.ts`); they stay.
- Per-user permissions beyond Medusa's normal admin login.

## Decisions carried from brainstorming

- One connection per marketplace. (Chosen: recommended option.)
- Changes apply live, no seller-hub restart. (Chosen: recommended option.)
- Admin page → Medusa admin route → seller-hub internal API; credentials are
  stored only by seller-hub, encrypted with its existing key. The Medusa
  database never holds them. (Chosen: option 1.)
- Amazon is read-only in this piece. (Proposed in the design, accepted.)

## Architecture

```
apps/seller-hub/src/
  internal/auth.ts              bearer-secret check (constant-time)
  internal/connections.ts       handlers: list, save, test, link, disconnect
  connectors/manager.ts         start/stop/restart Shopify + WooCommerce; per-marketplace lock
  connectors/credentials.ts     load credentials from the DB row, env as fallback
  shopify/bootstrap.ts          (changed) returns a stoppable handle
  woocommerce/bootstrap.ts      (changed) returns a stoppable handle
  webhook/server.ts             (changed) mounts /internal/connections; looks up the live connector per request
  db/schema.ts                  (changed) additive columns
  index.ts                      (changed) uses the manager instead of calling the bootstrap functions directly
apps/backend/src/
  api/admin/marketplace-connections/   routes that forward to seller-hub
  admin/routes/marketplace-connections/page.tsx   the screen (+ __tests__)
```

### Data

Additive, idempotent changes in `schema.ts` (`ADD COLUMN IF NOT EXISTS`):
- `integration_account.medusa_sales_channel_id TEXT` — the sales channel this
  connection feeds. Connectors keep resolving their channel by the existing name
  ("Shopify", "WordPress") when this is NULL.
- `integration_account.webhook_secret_encrypted TEXT` — the webhook signing
  secret (Shopify app secret; WooCommerce webhook secret), encrypted with
  `crypto/secret-box.ts`.

Existing columns are reused: `shop_domain` (Shopify domain or WooCommerce site
URL), `access_token_encrypted` (Shopify token or WooCommerce consumer secret),
`api_key` (WooCommerce consumer key), `shopify_location_id`, `status`,
`last_synced_at`. `status` is `connected`, `disconnected` or `error`; a new
`last_error TEXT` column holds the latest connect/test failure message.

### Configuration

- `SELLER_HUB_INTERNAL_SECRET` (seller-hub and backend): shared bearer secret.
  When unset in seller-hub, the `/internal/*` routes are not mounted. The
  backend routes return a clear "not configured" error.
- `SELLER_HUB_INTERNAL_URL` (backend): where to reach seller-hub's internal API.
- `SELLER_HUB_PUBLIC_URL` (seller-hub, optional): used only to show the webhook
  URL on the screen. When unset the screen shows the path only.
- Existing `SHOPIFY_*` / `WOOCOMMERCE_*` env variables keep working: used only
  when the database row has no saved credentials for that marketplace.

## Behaviour

- **Seller-hub internal API** (all require `Authorization: Bearer <secret>`,
  401 otherwise; secrets are never logged or returned):
  - `GET /internal/connections` — per marketplace: status, last sync time,
    linked-listing count, latest `last_error`, the sales channel id, whether
    credentials exist (a boolean), and non-secret fields (store domain, site
    URL, location id). Credentials are write-only: never returned, not even
    masked.
  - `PUT /internal/connections/:marketplace` (`shopify` or `woocommerce`) —
    validates the input, runs a live connection test with the submitted values,
    and only on success encrypts and stores them and starts or restarts that
    connector. On test failure nothing is stored and the old connection keeps
    running; the response carries the failure message. A blank secret field on
    an update keeps the stored value, so a domain or location can be changed
    without re-entering secrets.
  - `POST /internal/connections/:marketplace/test` — tests the stored
    credentials; updates `status` and `last_error`.
  - `POST /internal/connections/:marketplace/link` — runs the SKU link and
    returns the linked, unmatched and duplicate counts.
  - `DELETE /internal/connections/:marketplace` — stops the connector and clears
    the stored credentials and sets `status` to `disconnected`. Listings and
    sync history are kept.
  - `amazon` appears in `GET` only (read-only status); `PUT`/`DELETE` for it
    return 400 "not supported yet".
- **Connection test:** Shopify runs a shop query; WooCommerce reads one product
  (`per_page=1`). Timeout 10 seconds. The WooCommerce site URL must be
  `https://`; anything else is rejected before any request. Messages returned
  to the screen are short and never contain the credentials.
- **Live apply:** the connector manager starts and stops each marketplace's
  workers, queues and schedule. Saves, tests and disconnects for one marketplace
  run one at a time (per-marketplace lock). Start and stop are isolated: a
  failure in one connector never stops Amazon, the other connector, or the
  webhook server. Webhook routes resolve the live connector at request time, so
  a swap needs no server restart; a request that arrives while a connector is
  stopped gets a 503 so the sender retries.
- **Backend routes** (`/admin/marketplace-connections`, behind Medusa admin
  auth): validate input with Zod, forward to seller-hub, and map seller-hub
  errors to clear admin-visible messages. They never log request bodies.
- **Screen:** one card per marketplace.
  - Shopify: store domain, access token, webhook secret, location id.
  - WordPress: site URL, consumer key, consumer secret, webhook secret.
  - Each card: a sales channel picker (the existing channels), status badge,
    last sync, linked listings, latest error, buttons Save and connect, Test,
    Link products by SKU, Disconnect (with a confirmation).
  - After a successful save: the webhook URL to paste into the marketplace.
  - Secret fields show a "stored" placeholder, never the value. The Amazon card
    shows status only.
  - Independent loading and error states per card, and each action disables its
    button while running.

## Error handling

- Seller-hub unreachable or secret wrong: the page shows a banner with the cause
  (not configured / cannot reach / rejected) and keeps the rest usable.
- Test failure on save: stored connection untouched, message shown on the card.
- Connector start failure after a successful test: status `error`, `last_error`
  set, other connectors unaffected.
- A second save while one is running for the same marketplace waits its turn.

## Testing

- **Unit (seller-hub, vitest):** bearer check (missing, wrong, right, unset
  secret); credential loading (DB first, env fallback, blank-secret keeps
  stored); secrets never present in any response or log line; the manager's
  start/stop/restart and per-marketplace serialization; start failure isolated.
- **Integration with fake Shopify and WooCommerce servers:** save with good
  credentials stores and starts; save with bad credentials stores nothing and
  leaves the old connection running; restart swaps credentials without a
  process restart; disconnect stops sync; webhook arriving mid-swap gets 503;
  http:// WooCommerce URL is rejected.
- **Backend:** route validation, forwarding, error mapping, never logging bodies.
- **Admin page:** component tests in the existing style: cards render per
  marketplace, secret fields never show values, save/test/link/disconnect call
  the right route, failures show per card, the Amazon card is read-only.
- **Regression:** every existing Amazon, Shopify and WooCommerce test passes
  unchanged.
- **Before finishing:** seller-hub build and full suite; backend type check,
  lint and tests for the new routes and page. No real Shopify, WooCommerce or
  Amazon calls.

## Open assumptions to confirm

- The page is named **Marketplace connections**.
- Credentials are write-only: once saved they can be replaced but never viewed.
- The shared secret is the only protection on the internal API, so seller-hub's
  internal routes must be reachable only from the backend (same host or private
  network); they are not meant to be public.
- The webhook secret is entered by the owner for both marketplaces (Shopify's
  app secret; a secret of the owner's choice for WooCommerce).
- A sales channel picker only chooses among existing channels; creating a
  channel and linking it to the stock location and products still uses the setup
  scripts for now.
- A saved connection overrides the env variables for that marketplace.

## Review Focus

- Credentials never appear in any response, log line or error message, and are
  never stored in the Medusa database.
- A failed test on save leaves the working connection untouched.
- A Shopify or WooCommerce failure never stops Amazon, the other connector, or
  Medusa events.
- The internal API is unreachable without the shared secret.
- Two simultaneous saves for the same marketplace never leave workers
  duplicated or half-stopped.
- Existing env-configured setups keep working until a connection is saved.
