# Accounting: Expenses and Net Profit — Design

Fifth piece of the accounting module. Builds on the profit spec
(`2026-11-12-accounting-profit-design.md`: gross profit, the profit report and
page) and the payments spec (the `accounting` module, the workflow and admin
patterns). Adds the one thing the profit report lacked: running costs.

## Purpose

Let the store owner record business expenses (rent, ads, software and so on)
and see **net profit** next to gross profit.

**Intended outcome:** the admin opens Accounting -> Expenses, adds an expense
(date, category, amount, what it was for), and can edit or delete it. The
Profit page then shows, for any date range, expenses, net profit and net
margin beside gross profit, with expenses by category.

**Explicitly out of scope:**
- Recurring expenses, and spreading one expense across a period.
- A user-editable category list (the list is fixed).
- Supplier purchases and their shipping, tax and other costs: they are already
  in cost of goods, so they are never entered as expenses (no double counting).
  Supplier invoice and payment records are not expenses either.
- Attachments, receipts, vendors as records, approvals, and exports.
- Taxes owed, depreciation, and currencies other than USD.

## Decisions carried from brainstorming

- Accounting is built in pieces: 1 to 4 done; this is piece 5 (expenses and
  net profit). (Agreed.)
- Expenses are one-off entries, counted on their own date. (Chosen:
  recommended option.)
- Categories are a fixed list. (Chosen: recommended option.)
- Remaining design choices were left to the recommended defaults ("take all
  recommended"): a plain deletable record, additive changes to the profit
  report, and the screens below.

## Architecture

```
apps/backend/src/
  modules/accounting/       + models/expense.ts, service (Expense), migration
                            + expenses.ts (pure helpers: categories, summing)
  workflows/                create-expense, update-expense, delete-expense (+ steps/)
  api/admin/expenses/       route.ts, [id]/route.ts, middlewares.ts, map-expense.ts
  api/admin/profit-report/  (changed) load-expense-data.ts, route.ts
  modules/accounting/profit.ts  (changed) expenses and net profit
  admin/routes/accounting/  expenses/ (list + add/edit dialog), profit/ (changed)
```

The migration is generated with `npx medusa db:generate accounting`, never
hand-written. The accounting module imports nothing from other modules.

### Data model

**Expense** (in the `accounting` module; model `expense`, service key
`Expense`):

| Field | Notes |
|---|---|
| `id` | |
| `display_id` | autoincrement; shown as `EXP-0001` |
| `expense_date` | `dateTime`, stored as 00:00:00 UTC of the chosen day (the same way payment dates are) |
| `category` | `rent`, `marketing`, `software`, `payroll`, `shipping_packaging`, `fees`, `utilities`, `other` |
| `amount` | `bigNumber`, plain dollars, greater than 0, whole cents |
| `description` | required, trimmed, 1-200 characters (what it was for) |
| `payee` | optional, trimmed, at most 200 characters |
| `currency_code` | fixed `usd` |

Expenses are deleted with the module's soft delete, so a deleted expense stops
counting everywhere and the row remains in the database.

## Rules

- **Create / update:** `amount` is validated with the payment amount rule
  (`isValidPaymentAmount`: greater than 0, whole cents, relative tolerance);
  `expense_date` is a calendar date (`YYYY-MM-DD`, not in the future by more
  than one day to allow time zones); `category` is one of the fixed list.
  Update changes any of the fields. Business validation lives in workflow
  steps.
- **Delete:** soft delete; deleting twice returns 404 the second time.
- No locks are needed: each write touches one row and no rule spans rows.
- Expenses never change orders, stock, purchases, invoices or payments.

## Net profit (profit report changes)

All amounts are accumulated in integer cents like the rest of the report.
Expenses are counted on `expense_date` inside the range, bucketed with the same
UTC day/week/month rules as sales and cost.

- `expenses` = sum of expense amounts in the bucket.
- `net_profit` = `gross_profit - expenses` (may be negative).
- `net_margin_pct` = `net_profit / net_revenue * 100`, one decimal, `null` when
  `net_revenue <= 0` (same rule as `margin_pct`).
- The existing figures and `margin_pct` (gross margin) are unchanged.
- The summary is the sum of the trend.
- `expenses_by_category`: one entry per category that has expenses in the
  range, `{ category, amount }`, sorted by amount descending then category.

Both are additive changes to the response, so the existing fields keep their
meaning.

## API contract

All routes are admin-only (auth is automatic under `/admin/*`). Zod from
`@medusajs/framework/zod`; schema types exported. Only GET, POST and DELETE.

| Method and path | Purpose |
|---|---|
| `GET /admin/expenses` | List newest first (`expense_date` desc, then `display_id` desc). Filters: `category`, `from`, `to` (`YYYY-MM-DD`, inclusive), `q` (case-insensitive substring of description or payee; `%` and `_` literal). Paginated (`limit` 1-100 default 20, `offset`). Returns `expenses`, `count`, `offset`, `limit` and `total_amount` (sum over every match, not just the page) |
| `POST /admin/expenses` | Create: `expense_date`, `category`, `amount`, `description`, optional `payee` |
| `GET /admin/expenses/:id` | One expense |
| `POST /admin/expenses/:id` | Update any of the create fields |
| `DELETE /admin/expenses/:id` | Delete |

Expense responses: `id`, `reference` (`EXP-0001`), `expense_date`
(`YYYY-MM-DD`), `category`, `amount`, `description`, `payee`, `currency_code`,
`created_at`.

`GET /admin/profit-report` gains the fields above; its query is unchanged.

Errors use `MedusaError` with clear messages (invalid amount names the rule,
unknown category lists the allowed values, missing expense says so).

## UI

- **Accounting menu** gains **Expenses** beside Profit (path
  `/accounting/expenses`).
- **Expenses page:** a filter row (category, from, to, search), a table
  (reference, date, category, description, payee, amount, edit and delete
  actions), the total of the filtered expenses, pagination (clamped), loading,
  error with Retry, empty state ("No expenses yet"), and an **Add expense**
  button.
- **Add/edit dialog:** date (default today UTC), category, amount, description,
  payee. Strict numeric parsing, whole cents, inline server errors, a
  double-submit guard, and buttons disabled while saving.
- **Delete:** a confirmation prompt, then a toast; the list refreshes.
- **Profit page:** new cards **Expenses**, **Net profit**, **Net margin**; the
  trend table gains Expenses and Net profit columns; a new **Expenses by
  category** table. The existing cards and tables keep their meaning.
- All requests use `sdk.client.fetch`; mutations show toasts and invalidate
  `["admin","expenses"]` and `["admin","profit-report"]`.

## Testing

- **Unit:** category list and summing helpers; net profit, net margin and the
  `null` margin rule in `profit.ts`; expenses bucketed by day/week/month with
  boundary instants (`from` 00:00 in, `to`+1 00:00 out); 0.1 + 0.2 cent sums;
  expenses outside the range ignored; summary equals the sum of the trend;
  `expenses_by_category` ordering and totals; net profit negative.
- **Module integration:** the Expense model, defaults, `display_id`.
- **HTTP integration:** each route; amount rules (zero, negative, three
  decimals, 12.5 accepted); invalid category and date; description length;
  list filters (category, date range inclusive both ends, `q` with `%`/`_`
  literal), pagination, `total_amount` over all matches; update; delete then
  404; the profit report includes expenses, net profit, net margin and
  category totals and ignores deleted expenses; auth 401; stock and orders
  unchanged.
- **Admin pages:** component tests in the existing style for the Expenses page
  (list, filters, add, edit, delete confirm, errors, empty/loading/error) and
  the Profit page additions; the existing Profit tests stay green.
- **Before finishing:** build, lint, every test added, and the migration
  applied to the dev database.

## Open assumptions to confirm

- Menu name is **Expenses**.
- Expenses count on their own date (cash basis), and the fixed category list is
  Rent, Marketing, Software, Payroll, Shipping & packaging, Fees, Utilities,
  Other.
- Net margin uses net revenue as the base, like the gross margin.
- Delete is final from the UI (no restore).

### Verified during implementation

- The migration is `src/modules/accounting/migrations/Migration20261111211055.ts`.
- The accounting service methods used are `listExpenses` (with `take: null`
  for the profit report), `softDeleteExpenses` and `restoreExpenses` (the
  latter undoes a delete when a workflow rolls back).
- Creating an expense returns HTTP 200, like supplier payments.

## Deployment notes

- Run `npx medusa db:migrate` in `apps/backend` after merging (one new table).
- The profit report reads all expenses in the range in memory; revisit at
  roughly 20,000 expenses in a range.

## Review Focus

- A deleted expense stops counting immediately in every report.
- An expense at 23:59:59 UTC on `to` and one at 00:00:00 UTC the next day land
  in the right periods.
- Net profit and net margin handle zero or negative net revenue without errors.
- Purchase shipping, tax and other costs are never counted twice.
- Amounts like 12.499999999 are refused; 12.5 and 1e-2 style input is handled
  without a cent drift.
- `%` and `_` in the search are literal.
