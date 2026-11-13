# Marketplaces inside Sales Channels — Design

Replaces the standalone "Marketplace connections" admin page
(`2026-11-13-marketplace-connections-design.md`). That page is removed; its
credential saving, testing, encryption, live apply and internal API are reused.

## Purpose

Let the owner add a marketplace as a sales channel from the Sales channels area
of the admin, and add as many as they want (several Shopify stores, several
WordPress sites, several Amazon accounts).

**Intended outcome:** in Sales channels the owner clicks "Create", picks a
marketplace (Shopify, WordPress, Amazon, or "No marketplace" for a plain Medusa
channel), fills the fields that appear for that choice, and saves. StoreCentral
tests the credentials, creates the sales channel, links it to the stock location
and products, stores the credentials encrypted, and starts syncing orders, price
and inventory for that channel without restarting seller-hub.

**Explicitly out of scope:**
- Live Amazon sync. Amazon credentials are saved and shown, but no Amazon call is
  made and no job runs until the "Amazon going live" piece (SQS queue, app-level
  LWA/AWS credentials). The Amazon card says "Saved — sync not live yet".
- eBay, Walmart, or any other marketplace.
- Changing how orders, stock or price sync; only where credentials come from and
  how many connections can run.
- Per-channel pricing and reports, and a sync-status screen (postponed by the
  owner).
- Changes to Medusa core packages. Admin screens change only in this repo's
  dashboard fork (`packages/admin/dashboard`).

## Decisions

- One sales channel = at most one marketplace connection. Many connections per
  marketplace type. (Owner request.)
- Amazon is selectable now; credentials stored, sync not live. (Recommended.)
- "Create" makes the Medusa sales channel itself and links it to the stock
  location and products, replacing the manual setup scripts. (Recommended.)
- Credentials stay write-only and are stored only by seller-hub, encrypted with
  its existing key; the Medusa database never holds them.
- Changes apply live; the internal-secret model is unchanged.

## Architecture

```
packages/admin/dashboard/src/routes/sales-channels/
  sales-channel-create/        (changed) marketplace picker + type-specific fields
  sales-channel-detail/        (changed) "Marketplace connection" section
  components/marketplace-fields/   one field group per marketplace type + a registry
apps/backend/src/
  api/admin/marketplace-connections/  (changed) id-based routes; create does channel + connection
  workflows/ create-marketplace-sales-channel  channel + stock-location + products link (from setup scripts)
  admin/routes/marketplace-connections/   (removed)
apps/seller-hub/src/
  connectors/manager.ts        (changed) keyed by connection id, many per marketplace
  connectors/credentials.ts    (changed) per-account resolve; env only for the legacy account
  internal/connections.ts      (changed) id-based API incl. create
  shopify|woocommerce/bootstrap.ts  (changed) per-account queue names + webhook ids
  webhook/server.ts            (changed) /webhooks/<marketplace>/<accountId>
  amazon fields                stored only (no runtime)
  db/schema.ts                 (changed) additive
```

### Data

Additive, idempotent changes:
- `integration_account` allows many rows per `marketplace`. Add a unique index on
  `medusa_sales_channel_id` (where not null). Add `display_name TEXT`.
- Amazon reuses `lwa_refresh_token_encrypted`; add `amazon_seller_id TEXT` and
  `amazon_marketplace_id TEXT`.
- Each connection's `id` (UUID) is its identity everywhere: internal API, queue
  names, webhook URL.
- **Migration of today's rows:** the existing Shopify and WooCommerce rows keep
  working. A row that has a sales channel keeps it; a row without one resolves
  its channel by the old name ("Shopify"/"WordPress") exactly as today.

### Behaviour

- **Create flow** (backend `POST /admin/marketplace-connections`, behind admin
  auth): validate; run the seller-hub live test with the submitted credentials;
  only if it passes, create the sales channel (and link stock location and all
  products, as the setup scripts do), then save the connection to seller-hub.
  If the save fails, the new sales channel is deleted again. A failed test
  creates nothing. For "No marketplace" the normal Medusa create runs unchanged.
- **Detail page:** a "Marketplace connection" section on the sales channel:
  type, status badge, last sync, linked listings, latest error, non-secret
  fields, webhook URL to paste into the marketplace; actions Edit credentials,
  Test, Link products by SKU, Disconnect (with confirmation). Secret fields show
  "Stored", never the value; blank keeps the stored value.
- **Disconnect** stops that connection and clears its stored credentials, keeps
  listings and sync history, and leaves the sales channel in place. Deleting a
  sales channel that has a connection is blocked with a clear message.
- **Seller-hub internal API** (bearer secret, unchanged auth):
  `GET /internal/connections`, `POST /internal/connections` (create),
  `PUT|DELETE /internal/connections/:id`, `POST /:id/test`, `POST /:id/link`.
  Limits and error codes carry over (64 KB body cap, 422 `test_failed`,
  400 `invalid_input`, 409 `not_configured`).
- **Many connectors live at once:** the manager keeps one runtime per connection
  id, each with its own queues, workers and repeatable reconcile job (queue names
  include the id). Per-id lock; start/stop failures isolated to that connection.
  Sales channel for order import comes from the connection's
  `medusa_sales_channel_id`.
- **Webhooks:** `POST /webhooks/shopify/:accountId` and
  `/webhooks/woocommerce/:accountId` resolve the live runtime for that id
  (503 while stopped, 404 for an unknown id). The old un-suffixed URLs keep working
  for the legacy env/single account so existing webhooks are not broken.
- **Medusa events** (inventory and price changes) fan out to every live runtime;
  each acts only on its own listings.
- **Amazon type:** fields Seller ID, Marketplace ID (default US), LWA refresh
  token. Saved encrypted, status "saved — sync not live"; the manager does not
  start an Amazon runtime. The existing env-driven Amazon connector is untouched.
- **Marketplace fields registry:** each marketplace type declares its fields,
  required/secret flags and help text in one place; the create form and detail
  section render from it, so a later marketplace is one entry.

## Error handling

- Seller-hub unreachable / secret wrong: the form and section show the cause and
  keep the rest of the admin usable.
- Test failure on create/save: nothing created or changed; message on the form.
- Start failure after a successful test: status `error`, `last_error` set; other
  connections unaffected.
- Sales channel created but connection save fails: channel rolled back.

## Testing

- **seller-hub (vitest):** manager with several connections of one type (start,
  stop, restart, per-id serialization, one failing without affecting another);
  per-id webhook routing (unknown id 404, stopped 503, wrong signature 401);
  legacy URL still routes; migration of existing rows; secrets never in
  responses or logs; Amazon saves with no runtime and no outbound call.
- **Integration with fake Shopify/WooCommerce servers:** two Shopify connections
  sync independently; bad credentials create nothing.
- **backend:** create flow (success, failed test creates nothing, save failure
  rolls back the channel), delete-blocked, never logs bodies, workflow links
  stock location and products.
- **dashboard:** marketplace picker shows the right fields per type; secrets
  never prefilled; create and detail actions call the right routes; Amazon shows
  "sync not live".
- **Regression:** existing Amazon/Shopify/WooCommerce and sales-channel tests
  pass. Before finishing: seller-hub build + full suite; backend type check, lint
  and tests; dashboard type check and tests. No real Shopify, WooCommerce or
  Amazon calls and no writes to the live site.

## Open assumptions

- Webhook URLs for new connections include the connection id; the owner pastes
  them into the marketplace once.
- A sales channel holds at most one connection; two Shopify stores are two
  sales channels.
- Amazon app-level credentials (LWA client id/secret, AWS keys) stay in env for
  the future go-live piece; only per-seller values are entered in the admin.
- Deleting the old standalone page and its sidebar entry is acceptable since it
  was never used in production.

## Review Focus

- Credentials never appear in any response, log or error, and never in the Medusa
  database.
- A failed test or failed save never leaves a half-created sales channel.
- Two connections of the same type never share queues, jobs, listings or
  webhooks; one failing never stops the others, Amazon, or Medusa events.
- Existing single-account setups and their webhook URLs keep working.
- Webhook ids cannot be used to reach another connection's data.
