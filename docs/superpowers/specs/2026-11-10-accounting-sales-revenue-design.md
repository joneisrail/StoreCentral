# Accounting: Sales and Revenue — Design

Third piece of the accounting module. Builds on the supplier invoices and
payments specs (the `accounting` module, the Accounting sidebar group) and
reads Medusa's own orders. Same layering where it applies (route -> admin
page); there is no workflow because nothing is written.

## Purpose

Show the store owner how much was sold and how much revenue that made, for
any date range, without leaving the admin.

**Intended outcome:** the admin opens Accounting -> Sales, picks a date range
(last 7, 30 or 90 days, or custom dates) and a granularity (day, week or
month), and sees summary cards, a trend table and the top products. The
figures agree with the Orders page.

**Explicitly out of scope:**
- Writing anything: no new tables, no migration, no change to orders, stock,
  purchases, invoices or payments.
- Cost of goods and profit (piece 4 will reuse these figures).
- Manual sales entry, customer invoices, and a ledger of money received.
- Splits by sales channel or region, exports, and saved reports.
- Currencies other than USD (orders in other currencies are ignored).

## Decisions carried from brainstorming

- Accounting is built in pieces: 1 supplier invoices (done), 2 supplier
  payments (done), 3 sales and revenue (this), 4 profit. (Agreed.)
- First version is revenue reports only, computed from existing Medusa
  orders. (Chosen: recommended option.)
- An order counts as revenue on the date it is placed; refunds subtract on
  the date they happen. (Chosen: recommended option.)
- Views: summary cards, trend by day/week/month, top products. (Chosen.)
- Approach: compute on read from orders, in pages, in code. Stored daily
  totals and raw SQL were rejected. (Recommended, taken.)

## Architecture

```
apps/backend/src/
  modules/accounting/utils.ts       + sales helpers (pure): bucketing, totals
  api/admin/sales-report/           route.ts, middlewares.ts, build-sales-report.ts
  admin/routes/accounting/sales/    page.tsx (+ components, tests)
```

`build-sales-report.ts` is the only code that touches order data. It reads
orders with `query.graph` (route-level, like the other accounting reads);
the pure bucketing and rounding helpers live in `utils.ts` and are unit
tested without a database. The accounting module imports nothing from the
order module.

## Definitions

All amounts are plain dollars (`bigNumber` values read as numbers),
accumulated in integer cents using the existing `toCents` helper, and
returned as dollars rounded to 2 decimals.

Included orders: created within the range, currency `usd`, not canceled
(`canceled_at` is null) and not a draft (`status` not `draft`).

Per included order, from Medusa's computed totals (tax-exclusive, so tax is
reported separately and never counted as revenue):

| Figure | Source |
|---|---|
| `gross_sales` | `item_subtotal` (items before discounts, without tax) |
| `discounts` | `discount_subtotal` (without tax) |
| `shipping` | `shipping_subtotal` (without tax) |
| `tax` | `tax_total` (collected, shown but not revenue) |
| `units` | sum of item `quantity` |

Derived:
- `net_sales` = `gross_sales` - `discounts`.
- `revenue` = `net_sales` + `shipping`.
- `refunds` = sum of the absolute value of order transactions with
  `reference = "refund"` whose own date falls in the range, on orders that
  are not canceled and not drafts (the order itself may be older than the
  range). Refund amounts are as paid, so they include any tax refunded.
- `net_revenue` = `revenue` - `refunds` (may be negative for a range with
  more refunds than sales).
- `average_order_value` = `revenue` / `orders`, 0 when there are no orders.

Buckets use UTC dates. Week buckets start Monday (ISO) and are labeled by the
Monday date; month buckets are labeled `YYYY-MM`; day buckets `YYYY-MM-DD`.
The trend lists every bucket in the range, including empty ones (zeros), in
ascending order. A bucket covers only the part inside the range.

Top products: grouped by `variant_id` over the same included orders and
range; each group has `quantity` (units) and `revenue` (line subtotal minus
line discount subtotal, without tax and shipping). Items with no variant are
grouped by their line `title`. Sorted by `revenue` descending, then
`quantity` descending, then title; limited to `top` (default 10). Refunds and
returns are not deducted from product figures (they are order-level money).

## API contract

Admin-only (auth is automatic under `/admin/*`). Zod from
`@medusajs/framework/zod`; the schema's inferred type is exported. GET only.

`GET /admin/sales-report`

| Query | Rule |
|---|---|
| `from`, `to` | `YYYY-MM-DD` (UTC, both inclusive). Default: last 30 days ending today. `from` must not be after `to`; the range is at most 366 days |
| `granularity` | `day` (default), `week`, `month` |
| `top` | integer 1-50, default 10 |

Response:

```
{
  range: { from, to, granularity },
  currency_code: "usd",
  summary: { orders, units, gross_sales, discounts, net_sales, shipping, tax,
             revenue, refunds, net_revenue, average_order_value },
  trend: [{ period, orders, gross_sales, discounts, net_sales, shipping, tax,
            revenue, refunds, net_revenue }],
  top_products: [{ variant_id, product_id, title, quantity, revenue }]
}
```

Invalid dates, an inverted or over-long range, or an unknown granularity
return 400 with a clear `MedusaError` message.

Reading: orders are fetched in pages of 500 ordered by `created_at` then `id`
with only the needed fields (the totals above, `status`, `canceled_at`,
`currency_code`, `created_at`, items `variant_id`, `product_id`, `title`,
`quantity`, `subtotal`, `discount_subtotal`), and the refund transactions are
fetched separately for the range. The summary is the sum of the trend, so the
cards and the table always agree.

## UI

- **Accounting menu** gains **Sales** beside Invoices, Payments and Payables
  (path `/accounting/sales`, same nesting as the others).
- **Filters:** preset buttons (Last 7 / 30 / 90 days), two date inputs, a
  granularity select. Invalid ranges are blocked in the form with a message
  (no request sent).
- **Summary cards:** orders, units, gross sales, discounts, shipping, tax,
  revenue, refunds, net revenue, average order value.
- **Trend table:** period, orders, revenue, refunds, net revenue, with an
  inline proportional bar for revenue. Empty periods show zeros.
- **Top products:** title, units, revenue.
- All requests use `sdk.client.fetch`. Loading state, an error state with
  Retry, and an empty state ("No orders in this range"). Changing filters
  keeps the previous data visible until the new data arrives.

## Testing

- **Unit:** week and month bucketing across month and year boundaries and
  Monday starts; zero-filled buckets and partial first/last buckets;
  cents accumulation (0.1 + 0.2 style sums); average order value with zero
  orders; top-product grouping, variant-less items and tie ordering; range
  validation (inverted, over 366 days, bad dates).
- **HTTP integration:** a seeded set of orders checks every figure end to
  end: canceled and draft orders excluded; non-USD orders ignored; discounts
  and shipping; tax excluded from revenue; a refund dated in the range on an
  order placed before the range; a refund dated outside the range; orders on
  the first and last second of the range; summary equals the sum of the
  trend; top products; validation errors; no data returns zeros and an empty
  top list. A test proves the route changes no data.
- **Admin page:** component tests in the existing style for filters
  (presets, invalid range, no request while invalid), cards, trend, top
  products, loading, error with Retry and empty state.
- **Before finishing:** build, lint and every test added. There is no
  migration.

## Open assumptions to confirm

- Menu name is **Sales**.
- Dates and buckets are UTC.
- Revenue excludes tax; refunds include tax as paid, so `net_revenue` is
  slightly understated by refunded tax.
- Top products ignore returns and refunds.
- Medusa's order computed totals (`item_subtotal`, `discount_subtotal`,
  `shipping_subtotal`, `tax_total`) and the `order_transaction` entity are
  readable through `query.graph`; the first plan task verifies this against
  a real seeded order before anything else is built on it.

## Deployment notes

- The route loads every order in the requested range on each request. The
  366-day cap bounds one request; revisit (daily summary table kept by an
  order subscriber, or SQL aggregation) at roughly 20,000 orders in a
  range or when the endpoint exceeds about 2 seconds.

## Review Focus

- Totals agree with the Orders page for the same orders.
- A refund recorded today on an old order lands in today's bucket only.
- Canceled orders (and their refunds) never count.
- Midnight UTC boundaries: an order at 23:59:59 and one at 00:00:00.
- A range with no orders returns zeros and renders, not an error.
- 0.1 + 0.2 style sums do not drift by a cent.
