# Accounting: Profit — Design

Fourth and last piece of the accounting roadmap. Builds on
`2026-11-10-accounting-sales-revenue-design.md` (the sales loader, the
bucketing and the Sales page) and reads purchases and receipts from the
`purchase` module. Same layering as Sales (route -> admin page); nothing is
written, so there is no workflow.

## Purpose

Show the store owner how much gross profit the shop made for any date range,
by day, week or month and by product.

**Intended outcome:** the admin opens Accounting -> Profit, picks a date
range and a granularity, and sees net revenue, cost of goods sold, gross
profit and margin, a trend table, and profit by product. The revenue figures
agree with the Sales page.

**Explicitly out of scope:**
- Writing anything: no new tables, no migration, no change to orders, stock,
  purchases, invoices or payments.
- Business expenses and net profit (rent, ads, software).
- Using supplier invoice prices; cost comes from purchases.
- Putting returned goods back into stock cost, and carrier or label costs.
- FIFO or any stored cost ledger.
- Currencies other than USD, exports, and saved reports.

## Decisions carried from brainstorming

- Accounting is built in pieces: 1 invoices, 2 payments, 3 sales and revenue
  (all done), 4 profit (this). (Agreed.)
- Cost of an item sold is the weighted **average cost** of what was received.
  (Chosen: recommended option.)
- Profit means **gross profit**: net revenue minus cost of goods sold, with
  purchase shipping, tax and other costs spread over the received units.
  (Chosen: recommended option.)
- Approach: compute on read from existing orders and purchase receipts.
  The cost used for a sale is the running average **as of the sale time**, so
  later purchases never change past profit. (Recommended, taken.)

## Architecture

```
apps/backend/src/
  modules/accounting/profit.ts      pure: landed cost, running average, report
  modules/accounting/sales.ts       (changed) export the bucketing helpers
  api/admin/profit-report/          route.ts, middlewares.ts, load-cost-data.ts
  admin/routes/accounting/range.ts  shared date-range helpers (moved out of
                                    the Sales page)
  admin/routes/accounting/profit/   page.tsx (+ tests)
```

`load-cost-data.ts` is the only new code that touches purchase data; it uses
`query.graph` at route level like the other accounting reads. The orders and
refunds come from the existing `loadSalesData` unchanged. `profit.ts` is pure
(no database) and imports from `./sales` and `./utils`; the accounting module
imports nothing from the purchase module or `src/api`.

The Sales page's date helpers (`presetRange`, `parseDay`, `validateRange`,
`isoDay`) move to `accounting/range.ts` so both pages share one copy; the
Sales page behavior and tests do not change.

## Definitions

All amounts are plain dollars accumulated in integer cents (`toCents`) and
returned as dollars rounded to 2 decimals. Orders, refunds, the range, UTC
dates and buckets are exactly as in the Sales spec.

**Landed unit cost** of a purchase line: its `unit_cost` plus its share of the
purchase's extras. With `subtotal` = sum of `quantity * unit_cost` over the
purchase's lines and `extras` = `shipping_cost + tax + other_cost`:
- `subtotal > 0`: `landed = unit_cost * (1 + extras / subtotal)`.
- `subtotal = 0` and total quantity > 0: `landed = unit_cost + extras / total_quantity`.
- otherwise `landed = unit_cost`.

**Cost events** per variant: each receipt line becomes an event
`(received_at, quantity, landed)` using the purchase line it references.
Events are ordered by `received_at`, then id.

**Average cost of a variant at time t**: over the events with
`received_at <= t`, total landed cost divided by total received quantity.
There is no average (the sale is *uncosted*) when no event is at or before `t`
or the variant is unknown. It is the average of everything received so far,
not of what is on hand.

**Cost of a sold line**: `round(quantity * average_cost_at(order.created_at))`
in cents, per order line. A line with no average is uncosted: its units count
in `units_without_cost`, add no cost, and its revenue still counts.

Per bucket and in total:

| Figure | Meaning |
|---|---|
| `net_revenue` | the Sales page `net_revenue` (revenue minus refunds, shipping charged included) |
| `cogs` | sum of costs of sold lines |
| `gross_profit` | `net_revenue - cogs` (may be negative) |
| `margin_pct` | `gross_profit / net_revenue * 100`, one decimal; `null` when `net_revenue <= 0` |
| `units_without_cost` | units on uncosted lines |

The summary is the sum of the trend (cents), like Sales. Margin is computed
from the summed cents, never averaged from buckets.

**By product** (grouped by `variant_id`; lines with no variant by `title`):
`units`, `revenue` (line subtotal minus line discount, as in Sales top
products), `cogs`, `gross_profit` = `revenue - cogs`, `margin_pct`,
`units_without_cost`. Sorted by `gross_profit` descending, then `units`
descending, then title; limited to `top`. Product figures are item-level, so
they exclude shipping and refunds and do not add up to the summary.

## API contract

Admin-only (auth automatic under `/admin/*`). Zod from
`@medusajs/framework/zod`; schema type exported. GET only.

`GET /admin/profit-report` with the same query as the sales report: `from`,
`to` (`YYYY-MM-DD`, UTC, inclusive, default last 30 days, max 366 days),
`granularity` (`day` default, `week`, `month`), `top` (1-50, default 10).
Errors are the same 400s via `resolveRange`.

```
{
  range: { from, to, granularity },
  currency_code: "usd",
  summary: { orders, units, net_revenue, cogs, gross_profit, margin_pct,
             units_without_cost },
  trend: [{ period, orders, units, net_revenue, cogs, gross_profit,
            margin_pct, units_without_cost }],
  by_product: [{ variant_id, product_id, title, units, revenue, cogs,
                 gross_profit, margin_pct, units_without_cost }]
}
```

Reading: `loadSalesData(scope, range)` for orders and refunds; then
`loadCostData(scope, endExclusive)` returns purchases that have receipts
received before the end of the range (purchase `shipping_cost`, `tax`,
`other_cost`, lines `id`, `variant_id`, `quantity`, `unit_cost`, receipts
`id`, `received_at`, receipt lines `purchase_item_id`, `quantity`), in pages of
200 purchases. Receipts after the range end are ignored. Read-only.

## UI

- **Accounting menu** gains **Profit** beside Sales (path `/accounting/profit`).
- Same filters as Sales (presets 7/30/90, two dates, granularity), using the
  shared range helpers; invalid ranges are blocked with a message and no
  request.
- **Cards:** net revenue, cost of goods, gross profit, margin (shown as `—`
  when null), units without cost.
- **Warning** when `units_without_cost > 0`: "N units sold have no purchase
  cost yet, so their cost is not included."
- **Trend table:** period, net revenue, cost of goods, gross profit, margin,
  with an inline proportional bar for gross profit (0% for zero or negative).
- **By product table:** title, units, revenue, cost of goods, gross profit,
  margin.
- `sdk.client.fetch`; loading, error with Retry, empty state ("No orders in
  this range"); previous data stays visible while a new range loads.

## Testing

- **Unit (`profit.ts`):** landed cost (extras spread; subtotal-zero fallback;
  no extras); running average across two receipts of one variant and across
  two purchases at different costs; a receipt exactly at the sale time counts
  and one a millisecond later does not; later purchases do not change an
  earlier sale's cost; an uncosted sale adds no cost and counts its units;
  margin `null` when revenue is zero or negative; 0.1 + 0.2 style cent sums;
  summary equals the sum of the trend; by-product grouping, variant-less
  lines, and ordering; rounding per line.
- **Module of reuse:** a test that the exported bucket helpers keep the Sales
  behavior (Sales unit tests unchanged and green).
- **HTTP integration:** seeded purchases, receipts and orders check every
  figure end to end: exact cogs and profit for a single order; a sale before
  the first receipt is uncosted; a later higher-priced receipt leaves an
  earlier sale's profit unchanged; extras are allocated; canceled orders
  excluded (as in Sales); `net_revenue` equals the sales-report figure for
  the same range; validation errors; no data returns zeros; read-only.
- **Admin page:** component tests in the existing style for filters, cards,
  warning, trend, by-product, loading, error with Retry and empty state; the
  Sales page tests still pass after the helper move.
- **Before finishing:** build, lint, every test added. There is no migration.

## Open assumptions to confirm

- Menu name is **Profit**.
- Margin is gross profit over net revenue; `net_revenue` includes shipping
  charged to customers and refunded tax, so margin is approximate.
- Cost is the average of everything received so far, not of stock on hand;
  returns and write-offs are not reflected.
- Purchase costs, not supplier invoice prices, are used.
- Receipts of cancelled purchases count if they exist.

## Deployment notes

- Each request loads all orders in the range (as Sales) and every purchase
  with receipts before the range end. Revisit (stored cost snapshots kept by
  a receipt subscriber) at roughly 20,000 orders in a range, 5,000 purchases
  or when the endpoint exceeds about 2 seconds.

## Review Focus

- A sale before the first receipt is uncosted, not costed at zero.
- A purchase received after a sale never changes that sale's cost.
- Two purchases of one variant at different costs average by quantity.
- Purchase shipping, tax and other costs are in the cost, exactly.
- Revenue figures equal the Sales page for the same range.
- Negative or zero net revenue gives a `null` margin and a rendered page.
- 0.1 + 0.2 style sums do not drift by a cent.
