# Orders page — Slice C: search, filters, change history

Implements FR-07/08/09, FR-10/11/12 (as far as list-API fields allow) and
FR-43/44 + BR-09 of `SRS-order-management-page.md`. Builds on Slice A
(`2026-11-14-orders-slice-a-design.md`) and Slice B
(`2026-11-15-orders-slice-b-design.md`), both merged. Roles/permissions
(§2.2, NFR-05) are **not** in this slice (see "Deferred").

## What already exists (checked in the code)

- The orders list `q` search matches order number (`display_id`,
  `custom_display_id`), email and the shipping/billing address text fields
  (names, company, address lines, city, province, postal code, phone). It does
  **not** match product name, SKU or tracking number.
- The All tab table has Medusa's filter bar (region, sales channel, tags,
  created/updated dates) with filter chips; the Ready to Ship, Shipped, Awaiting
  Payment, On Hold and Cancelled tab tables have **no search and no filters**.
- Order detail already has notes (`ResourceNotesSection`) and a timeline that
  shows Medusa's own order changes (edits, claims, returns, fulfillments,
  payments). Our own actions (hold, release, void label, mark shipped,
  bulk-tag, email/ship-from changes) are **not** recorded anywhere.
- Saved views and `?view=` tab URLs exist (Slice A).

## Purpose

Staff find any order by SKU, product, tracking number, zip or email from any
tab, narrow lists with the filters the SRS asks for, and see a trustworthy
history of who did what to an order and when.

**Intended outcome:** type a SKU or tracking number in the search box on any
tab and get the matching orders; add filters (payment state, carrier, country,
total range, order date, item SKU…) with removable chips; open an order and see
"Held by <user>: reason", "Label voided by <user>", "Marked shipped by <user> via
UPS 1Z…" in its activity, alongside Medusa's own events.

**Explicitly out of scope:**
- Roles/permissions and Viewer-only access (deferred, own slice).
- Filters that need computed values (has-alert, ship-by date, due status,
  item count): they depend on client-side data and stay out.
- Sorting by computed columns (customer, due, ship date); order number, date and
  total sort as today.
- Back-filling history for events that happened before this release.
- Searching 500,000 orders in under 1 s: this store's volume does not need a
  dedicated search index; the plan adds the simple indexes below and measures.

## Decisions (recommended options taken)

- **Search** gets a backend search route that returns matching order ids; the
  dashboard uses it when the search box is non-empty. It unions the standard
  `q` matches with line-item SKU / title / product title matches and
  fulfillment tracking-number matches. The ids are capped at 200 per query (the safe URL size for an `id` list, as found in Slice A).
- **Filters and search on every tab table** through one shared hook so counts,
  tables and URL state stay consistent (`getViewQuery` stays the single source of
  tab semantics; user filters are added on top).
- **History** is a small custom module `order-events` (one table, one
  migration) written by our workflows; an admin route lists an order's events;
  the order activity merges them into the existing timeline.
- **Event actor** is the admin user id of the request (name shown from the user
  record), or `system` for automatic events (EasyPost shipped/delivered).

## Behaviour

### Search (all tabs)
- Search box on every tab table (placeholder "Search order, customer, SKU,
  product, tracking…"). Debounced; URL param `q` per tab prefix, so it is
  bookmarkable (FR-14) and applies **inside** the active tab and filters (FR-09).
- `GET /admin/order-search?q=<text>` (admin auth) → `{ order_ids:
  string[], truncated: boolean }`: ids whose
  (a) standard `q` fields match (via the order module's own search),
  (b) any line item has `variant_sku` / `title` / `product_title` matching
  (case-insensitive, partial words),
  (c) any fulfillment label has `tracking_number` containing the text.
  Minimum 2 characters, trimmed; `%`/`_` escaped. 400 for shorter input.
- With a non-empty `q` the tab tables request `GET /admin/orders` with
  `id: { $in: order_ids }` in addition to their tab params (and without `q`).
  When `truncated`, a notice says "Showing the first 200 matches — refine the
  search". No matches → empty state, no list request.
- Indexes (migration in the new module's folder is not possible for core
  tables): none added in this slice. The plan includes a measurement task:
  query time against the dev DB with the seeded data; if it exceeds 1 s at the
  current volume the plan's fallback is a `pg_trgm` index added through a
  backend migration script.

### Filters (all tabs)
- Filter bar on every tab table with chips (edit, remove, Clear all) using the
  existing data-table filter UI. Filters, all URL-persisted per tab prefix:
  order date range (`created_at`), payment status, fulfillment status (labels
  are the same as the list API's), sales channel, tags, region, country
  (shipping address country code), total range, **carrier** and **ship-from
  location** and **delivery method** (shipping method name), **item SKU**.
- Server-side support: payment/fulfillment status, sales channel, tags, region,
  date, total already exist in `GET /admin/orders`. Country, carrier, ship-from,
  delivery method and SKU are applied through the same search route:
  `GET /admin/order-search?...&country=US&carrier=UPS&ship_from=<location id>&delivery=<text>&sku=<text>`
  returning ids (all AND-combined with `q` when both are present); the
  dashboard then applies `id: { $in }` as above.
- Tab semantics always win: a user filter can narrow a tab, never widen it
  (e.g. a payment-status filter on Ready to Ship is intersected with the tab's
  own `payment_status`).

### Change history
- New module `order-events` (`apps/backend/src/modules/order-events`): model
  `order_event { id, order_id, type, actor ("system" or user id), old_value
  (json, nullable), new_value (json, nullable), created_at }`, indexes on
  `order_id`+`created_at`. Types: `order.held`, `order.released`,
  `order.label_voided`, `order.marked_shipped`, `order.canceled` (from the row
  menu), `order.shipped` (system, from EasyPost
  webhook), `order.delivered` (system).
- Written inside the existing workflows as a final step, best-effort in a
  separate transaction so a history write failure never fails the business
  action (logged with ids only): hold, release, void-label, mark-shipped
  workflows; the EasyPost webhook route (shipped/delivered); tag changes are core-owned
  and are not recorded in this slice (listed under Deferred).
- `GET /admin/orders/:id/events` → `{ events: [{ id, type, actor: { id, name |
  null } | "system", old_value, new_value, created_at }] }` newest first, up to
  200.
- The order Activity timeline merges these events (sorted by time) with the
  existing items, rendered with a one-line summary per type (reason for hold,
  carrier + tracking number for mark shipped, fulfillment id for void). Tracking
  numbers are shown to staff only.
- Retention: kept 2 years (NFR-08): a scheduled job deletes older rows daily.

## Architecture

```
apps/backend/src/
  modules/order-events/{index.ts,service.ts,models/order-event.ts,migrations/}  new
  links: none (order_id is a plain column; no link to the order module)
  workflows/steps/record-order-event.ts                         new (shared best-effort step)
  workflows/{hold-order,release-order,void-order-label,mark-order-shipped}.ts   (changed)
  api/webhooks/easypost/route.ts                                (changed) system events
  api/admin/order-search/route.ts + middlewares                 new
  api/admin/orders/[id]/events/route.ts                         new
  jobs/prune-order-events.ts                                    new (daily)
packages/admin/dashboard/src/
  hooks/api/order-search.tsx, order-events.tsx                  new
  routes/orders/order-list/components/order-list-table/
    use-tab-table-query.ts, tab-table-toolbar.tsx               new (search + filters + chips)
    view-order-table.tsx, ready-to-ship-table.tsx, shipped-table.tsx  (changed)
  routes/orders/order-detail/components/order-activity-section/
    order-timeline.tsx, activity-items.tsx                      (changed) merged events
  i18n/translations/en.json                                     keys
```

## Error handling

- Search route failure or timeout: the table shows an inline translated error
  with Retry (the tab tables stay usable without a search term).
- Events write failure: logged (order id + event type), business action
  succeeds; events fetch failure: timeline shows Medusa items and a small
  "history unavailable" note.
- Truncated search (more than 200 matches): notice, never silent.

## Testing

- **Backend:** order-events module (create/list/prune), record step is
  best-effort (throwing service does not fail the workflow), each workflow
  records exactly one event with correct old/new values and actor, EasyPost
  webhook records `system` events once, search route (SKU, title, product title,
  tracking number, `q` union, filters, escaping of `%`/`_`, min length,
  truncation, auth), events route (order, ordering, 404), integration specs
  against Postgres for search and events.
- **Dashboard:** search box debounce + URL param, `id $in` request shape, empty
  state, truncated notice, filter chips add/edit/remove/clear and URL
  persistence per tab prefix, tab semantics not widened by filters, merged
  timeline ordering and summaries, error states.
- **Regression:** Slice A/B behaviour and counts (counts ignore the search box
  and filters by design: they show the tab's size).

## Deferred

- Roles/permissions (Shipping staff / Customer service / Viewer): own slice
  after deciding the role model.
- Tag-change events (core-owned endpoints; would need a core change).
- Computed-value filters and sorts; dedicated search index.

## Open assumptions

- `order_line_item` exposes `variant_sku`, `title`, `product_title` and
  fulfillment labels expose `tracking_number` to the module's list queries
  (the plan's first task proves the exact entities/fields with a failing test).
- The admin user's display name is available from the user module for the
  events route.
- Up to 200 ids in one `id[$in]` list fits the list endpoint's query string (Slice A used the same cap for held ids); beyond it the notice asks the user to refine.

## Review Focus

- Search results never widen a tab or include held orders in Ready to Ship.
- No SQL injection / wildcard abuse via `q`; minimum length; auth required.
- History is append-only, written for every state change of our workflows, and
  a failed write never blocks the action; no secrets in event payloads.
- Existing tab counts and table rows still agree.
