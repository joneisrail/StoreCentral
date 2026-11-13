# Orders page — Slice A: tabs with counts, Hold, alerts, missing columns

Implements part of `SRS-order-management-page.md` (FR-10/40/41/42 partly, FR-34,
FR-39 row tags, BR-01/02/05/07 and §3.1, §3.5, §3.6). Builds on the existing
Ready to Ship table (`2026-11-01-bulk-order-fulfillment-design.md`). Slices B
(void label, mark shipped, tracking push-back) and C (search/filters, history,
roles) are separate specs.

## Purpose

Staff see at a glance how many orders are in each state, can park an order on
hold, are warned about problem orders, and see the channel, due status,
delivery method, tags and a row menu on every Ready to Ship row.

**Intended outcome:** open Orders, read live counts on six tabs, put an order on
hold with a reason and release it later, and spot problem orders by an alert
icon, without opening each order.

**Explicitly out of scope (later slices or phases):**
- Void label, mark shipped with own carrier, tracking sent back to channels (B).
- Search by SKU/zip/product/tracking, the full filter set, filter chips,
  history log with old/new values, roles/permissions (C).
- Address verification and the "item out of stock" alert (needs a verification
  service and an inventory availability fetch).
- Split, merge, automation rules, CSV import, select-all-matching.
- Changing how labels are bought or how rates are quoted.

## Decisions (recommended options taken)

- Tabs: All, Ready to Ship, Shipped, Awaiting Payment, On Hold, Cancelled; each
  shows a live count.
- **Hold** is stored as a reserved order tag `On hold` plus `metadata.hold`
  (`{ reason, held_at, held_by }`). No new table or migration.
- Held orders are excluded from Ready to Ship and from its bulk actions.
- Alerts are computed in the dashboard from data already loaded; no new service.
- Row menu offers Put on hold / Release / Cancel order now; Print, Split, Merge,
  Mark shipped appear in later slices.
- Admin UI changes live in the dashboard fork (`packages/admin/dashboard`); the
  one list-API addition (`exclude_ids`) is in the vendored `packages/medusa`.

## Tab definitions

| Tab | Rule |
| --- | --- |
| All | every order |
| Ready to Ship | fulfillment `not_fulfilled`/`partially_fulfilled`, payment `captured`/`partially_captured`, status not `canceled`, not on hold (existing rule + exclusions) |
| Shipped | existing Shipped rule, unchanged |
| Awaiting Payment | payment status `not_paid` or `awaiting`, status not `canceled`, not on hold |
| On Hold | has the `On hold` tag, status not `canceled` |
| Cancelled | status `canceled` |

Counts come from one lightweight list request per tab (`limit=1`, `fields=id`,
read `count`), cached 30 s and refreshed by the page's Refresh button and after
hold/release/cancel. Held ids for exclusions come from the On Hold query (the
held set is small); excluded with a new `exclude_ids` param on
`GET /admin/orders` (`id: { $nin }`), added to the vendored validators.

## Behaviour

- **Put on hold:** row menu asks for a reason (required, max 255). Backend
  route `POST /admin/orders/:id/hold { reason }` runs a workflow that creates
  the `On hold` tag if missing, attaches it, and writes `metadata.hold`. Allowed
  only for orders that are not shipped (fully fulfilled), not canceled, not
  already held; otherwise 400 with a clear message.
- **Release:** `POST /admin/orders/:id/release` removes the tag and clears
  `metadata.hold`; the order returns to its natural tab.
- **Cancel:** the row menu reuses the existing Medusa cancel-order flow; allowed
  only when not fully shipped (BR-02: an order with a bought label must have it
  voided first, which arrives in Slice B — until then cancel is blocked for any
  order with a fulfillment label).
- **Hold badge/reason:** held rows show an "On hold" badge with the reason on
  hover; the On Hold tab shows the reason column.
- **Alerts column** (icon, hover lists every reason, row gets a soft highlight):
  missing weight (any item without a weight), no rates returned or quote error
  for the row, payment pending (visible on All/Awaiting Payment), P.O. box
  address with a non-USPS selected rate, high value (total above the threshold,
  default 500 in the store currency, set in Settings > Fulfillment as
  `store.metadata.high_value_threshold`).
- **Columns added to Ready to Ship:** Alerts, Channel (name chip with a stable
  colour per channel), Due (badge: Overdue / Due today / Due tomorrow / Due in N
  days, from the existing ship deadline; the existing Ship Time countdown stays
  as the tooltip), Delivery (the order's shipping method name, read only), Email
  (toggle, default on; sets the fulfillment's `no_notification` when off, only
  if the batch route already forwards it — otherwise the toggle is added to the
  route in this slice), Tags (coloured chips plus "+" using the existing tag
  modal), Actions (Fulfill button as today plus the row menu).
- **Overdue banner** (FR-42): a banner above the Ready to Ship table shows the
  number of overdue orders and sorts/scrolls to them on click (filters the
  table to overdue rows on the loaded page).
- **Column settings** are out of scope (existing table behaviour unchanged).

## Architecture

```
packages/medusa/src/api/admin/orders/validators.ts      (changed) exclude_ids
apps/backend/src/workflows/hold-order.ts, release-order.ts     new
apps/backend/src/workflows/steps/ (ensure-hold-tag, set-hold-metadata, ...)  new
apps/backend/src/api/admin/orders/[id]/{hold,release}/route.ts  new + middlewares
apps/backend/src/admin/routes/settings/fulfillment/page.tsx     (changed) high-value threshold
packages/admin/dashboard/src/
  hooks/api/order-holds.tsx                             new (hold, release)
  hooks/api/order-view-counts.tsx                       new
  routes/orders/order-list/components/order-list-table/
    order-list-tabs.tsx                                 (changed) six tabs + counts
    components/ready-to-ship-table.tsx                  (changed) new columns, exclusions
    components/order-alerts.ts(x)                       new: pure alert computation + cell
    components/channel-chip.tsx, due-badge.tsx, delivery-cell.tsx,
      email-toggle.tsx, row-tags-cell.tsx, row-actions-menu.tsx,
      hold-order-prompt.tsx, overdue-banner.tsx         new
    components/awaiting-payment-table.tsx, on-hold-table.tsx,
      cancelled-table.tsx                               new (small tables)
  i18n/translations/en.json                             keys
```

## Error handling

- Hold/release failure shows a toast with the server message and leaves the row
  unchanged; a double click cannot hold twice (route is idempotent per state:
  already held returns 400, and the button disables while pending).
- Count request failure shows "–" for that tab and does not block the page.
- Alert computation never throws: a missing field yields no alert, not an error.

## Testing

- **Backend:** hold workflow (creates tag once, attaches, writes metadata;
  rejects shipped/canceled/already held; release restores), routes (validation,
  400 messages), `exclude_ids` validator param.
- **Dashboard:** alert computation (each rule, none, malformed data), due badge
  buckets (overdue/today/tomorrow/N days, store time zone), tab counts (loading,
  error, refresh), six tabs render and link with `?view=`, Ready to Ship
  excludes held ids, hold prompt requires a reason, row menu actions call the
  right hooks, email toggle maps to `no_notification`, channel chip colour is
  stable per name.
- **Regression:** existing Ready to Ship, Shipped and bulk-fulfill tests pass
  unchanged. Before finishing: dashboard typecheck/lint/tests/build, backend
  type check, lint and unit tests. No real carrier calls.

## Open assumptions

- The Medusa list API can filter by tag id (confirmed: `tag_id`) and by payment
  and fulfillment status; the `id: { $nin }` query filter works on orders (to be
  proven by the first backend test; if not, the exclusion falls back to an
  `exclude_ids` implemented as an `$and` of `$ne`).
- Held orders are few (tens), so passing their ids as an exclusion list is fine.
- "Due" reuses the per-channel handling hours already configured; channels
  without one show no Due badge.
- High-value threshold uses the store currency's major units.

## Review Focus

- A held order can never be bulk-fulfilled, and releasing restores it exactly.
- Counts match the table contents for every tab (same filters).
- Hold/release/cancel never apply to shipped or already-canceled orders.
- Alert logic never crashes on orders with missing items, weights or addresses.
- Existing Ready to Ship behaviour (rates, package, ship-from, bulk fulfill)
  is unchanged for non-held orders.
