# Accounting: Overview — Design

Sixth piece of the accounting module. Reads the profit report
(`2026-11-12-accounting-profit-design.md`, `2026-11-12-accounting-expenses-design.md`)
and the supplier balances (payments spec). Adds one page and one small additive
change to the balances endpoint.

## Purpose

Give the store owner one page that answers "how is the shop doing, and what do
I owe?" the moment they open Accounting.

**Intended outcome:** the admin clicks Accounting and lands on Overview. It
shows, for a chosen date range, net revenue, gross profit, expenses, net profit
and net margin with a trend, and, as of today, how much is owed to suppliers.

**Explicitly out of scope:**
- Recent-activity feed, exports, saved ranges, charts from a library.
- New tables, migrations or workflows. Nothing is written.
- Currencies other than USD.

## Decisions carried from brainstorming

- Contents: profit snapshot, money owed to suppliers, trend. (Chosen: all
  three recommended; recent activity declined.)
- Placement: the Accounting entry opens Overview instead of redirecting to
  Invoices, and Overview also appears in the menu beside Sales and Profit.
  (Chosen: recommended option.)
- Remaining choices left to the recommended defaults: last 30 days by default,
  daily granularity default, inline proportional bars.

## Architecture

```
apps/backend/src/
  api/admin/supplier-balances/  (changed) totals in the response
  admin/routes/accounting/
    page.tsx                    (changed) redirect to /accounting/overview
    overview/page.tsx           new page (+ __tests__)
    types.ts                    (changed) totals type
```

The page reads `GET /admin/profit-report` (unchanged) and
`GET /admin/supplier-balances` (additive field). It shares `range.ts` with the
Sales and Profit pages.

### Supplier balances: totals

The balances endpoint is paginated (max 100 per page) and has no totals, so a
client cannot get the total owed without reading every page. Add to the
response a `totals` object computed over **every matching supplier row**, not
just the page:

```
totals: { balance_owed, overdue_total, open_invoices, suppliers }
```

`suppliers` = number of rows (equal to `count`). Sums are accumulated in integer
cents (`toCents`) and returned as dollars rounded to 2 decimals; existing
fields keep their meaning. The sum helper is a pure function next to
`summarizeBalances`.

## Page

- **Range:** presets 7/30/90 and two date inputs (default last 30 days) using
  `range.ts`; granularity day/week/month (default day). Invalid ranges are
  blocked with a message and no profit request.
- **Profit cards:** Net revenue, Gross profit, Expenses, Net profit, Net
  margin (`—` when null). Values equal the Profit page for the same range.
- **Trend table:** period, net revenue, net profit, with an inline proportional
  bar for net profit (0% for zero or negative). Bar scale is the largest net
  profit in the range.
- **Owed to suppliers:** cards Total owed, Overdue, Open invoices, labelled
  "as of today" so it is clear the range does not apply. A link to
  `/accounting/payables`.
- **Independent sections:** each section has its own loading state, error with
  Retry, and renders without the other. The profit empty state ("No orders or
  expenses in this range") uses the Profit page rule: no orders, no refunds,
  no expenses.
- Requests use `sdk.client.fetch`; previous data stays visible while a new
  range loads; the profit query key matches `["admin","profit-report", ...]`
  so existing invalidations keep it fresh.

## Testing

- **Unit (backend):** the totals helper: sums of several suppliers, cents
  accuracy (0.1 + 0.2), zero rows, overdue only counted from posted open
  invoices as in `summarizeBalances`.
- **HTTP integration:** `supplier-balances` returns `totals` over all matches
  (more than one page, `q` filter narrows the totals, empty returns zeros);
  existing balance assertions stay green.
- **Admin page:** component tests in the existing style: profit cards and
  trend, balances cards and link, supplier section failing while profit loads
  (and the reverse), Retry per section, invalid range makes no profit request,
  preset change refetches, empty state, null margin, "as of today" label; the
  Accounting redirect test points at `/accounting/overview`.
- **Before finishing:** build, lint, every test added. No migration.

## Open assumptions to confirm

- Menu name is **Overview**.
- The balances `totals` are all-time as of today (posted invoices only), not
  affected by the date range.
- Net profit bars use net profit only (expenses are in the cards).

## Review Focus

- Totals cover suppliers beyond the first page and respect the `q` filter.
- One section failing never blanks the other.
- Overview cards equal the Profit page figures for the same range.
- Zero or negative net revenue shows `—` for margin and still renders.
- The Accounting click lands on Overview and does not loop.
