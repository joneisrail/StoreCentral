# Accounting: Expenses and Net Profit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record business expenses (fixed categories, one-off entries) in the accounting module and show expenses, net profit, net margin and expenses by category on the Profit report and page.

**Architecture:** A new `expense` model in the `accounting` module (migration generated, never hand-written); create/update/delete workflows; `/admin/expenses` routes; the pure `profit.ts` gains expense bucketing and net profit; the profit route loads expenses and passes them in; two admin pages (new Expenses page, extended Profit page).

**Tech Stack:** Medusa v2 (DML models, `MedusaService`, workflows, `db:generate`), Zod from `@medusajs/framework/zod`, React + `@medusajs/ui` + react-query, jest.

**Spec:** `docs/superpowers/specs/2026-11-12-accounting-expenses-design.md` (binding).

## Global Constraints

- All code under `apps/backend`. Branch `feat/accounting-expenses`, main checkout; do not touch the running dev server; never push or merge. **Do not run `db:migrate` against the dev database** (tests use their own database); the controller will report the migration as a follow-up.
- Migrations only via `npx medusa db:generate accounting`; never hand-write or edit one.
- Model `expense`, service key `Expense` (list method `listExpenses`, soft delete `softDeleteExpenses`); fields: `id`, `display_id` (autoincrement, shown `EXP-0001`), `expense_date` (`dateTime`, 00:00:00 UTC of the chosen day), `category` enum (`rent`, `marketing`, `software`, `payroll`, `shipping_packaging`, `fees`, `utilities`, `other`), `amount` (`bigNumber`, > 0, whole cents), `description` (required, trimmed, 1-200 chars), `payee` (nullable, trimmed, <= 200), `currency_code` (default `usd`).
- Amount validation reuses `isValidPaymentAmount` and `toCents` from `src/modules/accounting/utils.ts`; money is accumulated in integer cents and returned in dollars rounded to 2 decimals. `expense_date` must be a real calendar date (`z.iso.date()`) and not more than one day after today (UTC). Business validation lives in workflow steps; routes stay thin. Only GET, POST, DELETE.
- Net profit: `net_profit = gross_profit - expenses`; `net_margin_pct = net_profit / net_revenue * 100`, one decimal, `null` when `net_revenue <= 0`. Expenses count on `expense_date` inside the range with the same UTC day/week/month bucketing as sales; summary is the sum of the trend; existing fields (including `margin_pct`) keep their meaning. `expenses_by_category`: one `{ category, amount }` per category with expenses in range, sorted by amount desc then category.
- List: newest first (`expense_date` desc, `display_id` desc), filters `category`, `from`, `to` (inclusive `YYYY-MM-DD`), `q` (case-insensitive substring of description or payee, `%` and `_` literal via `escapeLike` from `src/modules/supplier/utils`), `limit` 1-100 default 20, `offset`; response includes `total_amount` over every match.
- Zod v4 (`z.iso.date()`); export schema and inferred type. Admin requests use `sdk.client.fetch`; invalidate `["admin","expenses"]` and `["admin","profit-report"]` after mutations.
- Admin test lessons: stateful mock server with fresh objects, wait for rendered signals, flush (`await act(async () => {})`) before "no call" assertions, no effects that reset local form state on refetch, strict numeric parsing, double-submit guard, prove key tests against deliberately broken variants.
- HTTP suites run in batches of at most 3 files (`yarn test:integration:http <file>`); `yarn build` and `yarn lint` must pass with 0 errors.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A deleted expense stops counting in the list total and the profit report (Tasks 2, 4).
- Boundary instants: expense on `to` counts, on `to`+1 does not, on `from` counts (Tasks 3, 4).
- Zero or negative net revenue gives `null` net margin and a rendered page (Tasks 3, 6).
- Amounts: 12.499999999 refused, 12.5 accepted, 0.1 + 0.2 sums exact (Tasks 2, 3).
- `%` and `_` in search are literal (Task 2).
- Purchase shipping/tax/other never appear as expenses (nothing reads them; Task 4 test that cogs is unchanged by adding expenses).

---

### Task 1: Expense model, service, helpers and migration

**Files:**
- Create: `src/modules/accounting/models/expense.ts`, `src/modules/accounting/expenses.ts`
- Modify: `src/modules/accounting/service.ts` (register `Expense`)
- Create (generated): `src/modules/accounting/migrations/Migration<timestamp>.ts` via `npx medusa db:generate accounting`
- Test: `src/modules/accounting/__tests__/expenses.unit.spec.ts`, `integration-tests/modules/` accounting module spec in the style of `payment-module.spec.ts`

**Interfaces:**
- Produces (`expenses.ts`): `EXPENSE_CATEGORIES` (readonly tuple, the eight values above in that order), `type ExpenseCategory`, `formatExpenseReference(displayId: number): string` (`EXP-0001`), `EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string>` ("Rent", "Marketing", "Software", "Payroll", "Shipping & packaging", "Fees", "Utilities", "Other").
- Produces (service): `AccountingModuleService` gains `listExpenses`, `listAndCountExpenses`, `retrieveExpense`, `createExpenses`, `updateExpenses`, `softDeleteExpenses`, `restoreExpenses`.

- [ ] **Step 1: Write failing tests**: unit tests for `formatExpenseReference(1) === "EXP-0001"`, `(12345) === "EXP-12345"`, the category tuple order and labels; a module integration spec (copy `payment-module.spec.ts` setup) that creates an expense, checks defaults (`currency_code` `usd`, `payee` null), an auto-incrementing `display_id`, soft delete hiding it from `listExpenses`, and `restoreExpenses` bringing it back.
- [ ] **Step 2: Run** `yarn test:unit src/modules/accounting/__tests__/expenses.unit.spec.ts` and `yarn test:integration:modules` (the new spec); expected FAIL.
- [ ] **Step 3: Implement** the model, helpers and service registration; run `npx medusa db:generate accounting` and keep only the generated migration (check it creates `expense` with a `display_id` sequence and no change to other tables).
- [ ] **Step 4: Run** both test commands; expected PASS; run `yarn build`.
- [ ] **Step 5: Commit** `feat(backend): add the expense model`.

### Task 2: Expense workflows, API routes and HTTP tests

**Files:**
- Create: `src/workflows/create-expense.ts`, `update-expense.ts`, `delete-expense.ts`, `src/workflows/steps/create-expense.ts`, `update-expense.ts`, `delete-expense.ts`
- Create: `src/api/admin/expenses/route.ts`, `[id]/route.ts`, `middlewares.ts`, `map-expense.ts`
- Modify: `src/api/middlewares.ts` (register `expenseMiddlewares`)
- Test: `integration-tests/http/expenses.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers and service; patterns from `record-payment` workflow/step and `supplier-payments` route/middlewares/mapper.
- Produces: step inputs `CreateExpenseStepInput = { expense_date: string; category: ExpenseCategory; amount: number; description: string; payee?: string | null }`, `UpdateExpenseStepInput = { id: string } & Partial<CreateExpenseStepInput>`, delete input `{ id: string }`; each step has compensation (delete the created row; restore previous values; restore the soft-deleted row). `mapExpense(row): AdminExpense = { id, reference, expense_date: "YYYY-MM-DD", category, amount: number, description, payee, currency_code, created_at }`. Routes per the spec: `GET/POST /admin/expenses`, `GET/POST/DELETE /admin/expenses/:id`; schemas `CreateExpenseSchema`, `UpdateExpenseSchema` (all optional, at least one field), `ListExpensesQuerySchema` (`from` after `to` -> 400) exported with inferred types; `expenseMiddlewares: MiddlewareRoute[]`. List response `{ expenses, count, offset, limit, total_amount }`.

- [ ] **Step 1: Write the failing HTTP spec** (runner + `createAdminUser` as in `supplier-payments.spec.ts`), exact values: create returns `reference` `EXP-0001`, `expense_date` `2026-03-05`, amount 12.5; amount rules (0, negative, 12.499999999, 12.345 refused with 400 and message naming the rule; 12.5 and 100 accepted); unknown category 400 listing allowed values; bad date and a date more than one day in the future 400; description empty/whitespace and 201 chars 400, payee trimmed and blank -> null; update changes fields and re-validates; empty update body 400; delete then GET 404 and second delete 404; list order and `count`; filters `category`, `from`/`to` inclusive on both ends (expense on `from`, on `to` counted; the day after `to` not), `q` matching description and payee case-insensitively with `%` and `_` literal (e.g. `100%` does not match `100x`), pagination, and `total_amount` summing every match across pages; deleted expenses excluded from list and total; 401 without auth; creating an expense does not change order or stock counts.
- [ ] **Step 2: Run** `yarn test:integration:http integration-tests/http/expenses.spec.ts`; expected FAIL (404).
- [ ] **Step 3: Implement** steps, workflows (single-step, `WorkflowResponse({ expense })`), routes (reads through the accounting service with `take`/`skip` and `order`), mapper, middlewares and registration. Date storage: `new Date(`${date}T00:00:00.000Z`)`.
- [ ] **Step 4: Run** the spec; expected PASS. Prove the inclusive-`to` and `%`-literal tests fail against deliberately broken variants (e.g. `$lt` the end day itself; unescaped `q`), restore.
- [ ] **Step 5: Run** `yarn build` and `yarn lint` (0 errors); commit `feat(backend): add expense workflows and routes`.

### Task 3: Net profit in the pure profit calculation

**Files:**
- Modify: `src/modules/accounting/profit.ts`
- Test: `src/modules/accounting/__tests__/profit.unit.spec.ts` (extend; existing tests stay green)

**Interfaces:**
- Consumes: `bucketKey`, `parseDay`, `cents`, `DAY_MS` from `./sales`; `ExpenseCategory` from `./expenses`.
- Produces: `ProfitTotals` gains `expenses: number`, `net_profit: number`, `net_margin_pct: number | null`; `ProfitReport` gains `expenses_by_category: { category: string; amount: number }[]`; `buildProfitReport` input gains `expenses: { expense_date: string | Date; category: string; amount: unknown }[]` (default `[]` is NOT allowed: callers must pass it, so an existing call without it fails to compile and is fixed).

- [ ] **Step 1: Write failing unit tests** (exact values): expenses sum into their day/week/month bucket; net_profit = gross_profit - expenses and may be negative; `net_margin_pct` one decimal and `null` when net revenue is 0 or negative; boundary instants (an expense on `from` 00:00:00.000Z in; on `to` 00:00:00.000Z in; on `to`+1 day out; on `from`-1 ms out); `0.1 + 0.2 + 0.7` expense sums give exactly 1; summary equals the sum of the trend (expenses, net_profit); summary net margin from summed cents (differs from the mean of bucket margins in a crafted case); `expenses_by_category` totals, omission of empty categories, ordering amount desc then category asc; no expenses -> `expenses` 0, `net_profit` equals `gross_profit`, empty category list; existing profit tests updated only by adding `expenses: []` to their inputs.
- [ ] **Step 2: Run** `yarn test:unit src/modules/accounting/__tests__/profit.unit.spec.ts`; expected FAIL.
- [ ] **Step 3: Implement** in `profit.ts`: accumulate expense cents per bucket with the same range guard as orders; add the new fields to every bucket and the summary through the shared totals builder; keep all existing output unchanged.
- [ ] **Step 4: Run** the unit file; expected PASS. Prove two tests fail against deliberate breaks (include the `to`+1 day expense; compute net margin as the mean of bucket margins), restore.
- [ ] **Step 5: Commit** `feat(backend): add expenses and net profit to the profit calculation`.

### Task 4: Profit route loads expenses

**Files:**
- Create: `src/api/admin/profit-report/load-expense-data.ts`
- Modify: `src/api/admin/profit-report/route.ts`
- Test: `integration-tests/http/profit-report.spec.ts` (extend; existing tests stay green)

**Interfaces:**
- Consumes: Task 1 service, Task 3 `buildProfitReport` input.
- Produces: `loadExpenseData(scope: MedusaContainer, range: { from: string; to: string }): Promise<{ expense_date: Date | string; category: string; amount: unknown }[]>` reading through the accounting service (`listExpenses` with `expense_date >= from 00:00Z` and `< to+1 day 00:00Z`, `take: null`); the route passes the result as `expenses`.

- [ ] **Step 1: Write failing HTTP tests** (reuse the file's fixtures; create expenses through `POST /admin/expenses`): net profit and net margin exact for one order plus two expenses (e.g. gross profit 30, expenses 12.5 + 7.5 -> net profit 10, net margin from net revenue 40); `expenses_by_category` totals and order; an expense dated before `from` or after `to` is ignored; boundary dates (on `from` and on `to` counted, the day after `to` not); a deleted expense stops counting; zero net revenue -> `net_margin_pct` null with a 200; `cogs` and `gross_profit` identical with and without expenses (expenses never touch cost of goods); no expenses -> zeros and an empty category list; the read-only test still holds.
- [ ] **Step 2: Run** `yarn test:integration:http integration-tests/http/profit-report.spec.ts`; expected FAIL on the new tests.
- [ ] **Step 3: Implement** the loader and route change.
- [ ] **Step 4: Run** `profit-report.spec.ts` and `expenses.spec.ts`; expected PASS. Prove the deleted-expense and boundary tests fail against a deliberately broken loader filter, restore.
- [ ] **Step 5: Run** `yarn build` and `yarn lint`; commit `feat(backend): include expenses in the profit report`.

### Task 5: Expenses page

**Files:**
- Create: `src/admin/routes/accounting/expenses/page.tsx`, `src/admin/routes/accounting/expenses/components/expense-dialog.tsx`, `src/admin/routes/accounting/expenses/__tests__/page.unit.spec.tsx`
- Modify: `src/admin/routes/accounting/types.ts` (`Expense`, `ExpenseCategory`, list response), `src/admin/routes/accounting/format.ts` only if a shared label map is needed (otherwise keep `EXPENSE_CATEGORY_LABELS` local in `expenses/labels.ts`; the admin cannot import from `src/modules`)

**Interfaces:**
- Consumes: `/admin/expenses` (Task 2); patterns from `payments/page.tsx` (filters, pagination clamp, retry) and the Record payment dialog (`invoices/[id]/components/record-payment-dialog.tsx`: strict numeric parsing, double-submit guard); `formatUsd` from `../../purchases/format`; `validateRange`/`presetRange` are not needed (plain from/to filters).
- Produces: default-exported `ExpensesPage` with `defineRouteConfig({ label: "Expenses" })` (no `nested`); query key `["admin","expenses", category, from, to, q, offset]`.

- [ ] **Step 1: Write failing component tests** (stateful mock server, fresh objects): list renders reference, date, category label, description, payee, amount; filtered total shown from `total_amount`; filters send exact params (category, from, to, debounced q) and reset offset; pagination clamps when the count shrinks; empty state "No expenses yet"; loading and error with Retry (params asserted); Add dialog: defaults date to today (UTC) and category to Other, strict amount parsing (`12.5` ok; `12.345`, `abc`, `1e2`, empty, `0` blocked with a message and no request), whole cents only, description required, double-click Save sends one request, server error shown inline and dialog stays open with entered values, success closes, toasts and refreshes the list; Edit dialog prefilled and sends only changed fields; Delete asks for confirmation, cancel sends nothing, confirm calls DELETE and refreshes.
- [ ] **Step 2: Run** `yarn test:unit src/admin/routes/accounting/expenses`; expected FAIL.
- [ ] **Step 3: Implement** the page and dialog.
- [ ] **Step 4: Run** the tests; expected PASS. Prove the double-submit and strict-parsing tests fail against broken variants, restore.
- [ ] **Step 5: Commit** `feat(backend): add the expenses page`.

### Task 6: Profit page shows net profit; final verification

**Files:**
- Modify: `src/admin/routes/accounting/profit/page.tsx`, `src/admin/routes/accounting/types.ts` (`ProfitTotals` gains `expenses`, `net_profit`, `net_margin_pct`; `ProfitReport` gains `expenses_by_category`)
- Test: `src/admin/routes/accounting/profit/__tests__/page.unit.spec.tsx` (extend; existing tests updated only for the new mock fields)

**Interfaces:**
- Consumes: the extended `/admin/profit-report` (Task 4); category labels from Task 5's `expenses/labels.ts`.
- Produces: new cards **Expenses**, **Net profit**, **Net margin** (`—` when null); trend table columns Expenses and Net profit after Gross profit; new **Expenses by category** table (category label, amount) hidden when empty; existing cards and tables unchanged.

- [ ] **Step 1: Write failing tests**: the three cards show exact USD/percent text, net margin `null` renders `—`; the trend rows show expenses and net profit values for every row; the category table lists labels and amounts in the order received and is absent when `expenses_by_category` is empty; negative net profit renders as a negative USD value; all existing profit page tests still pass.
- [ ] **Step 2: Run** `yarn test:unit src/admin/routes/accounting/profit`; expected FAIL.
- [ ] **Step 3: Implement** the page changes.
- [ ] **Step 4: Run** the tests; expected PASS; prove one new test fails against a deliberate break (swap the Expenses and Net profit columns), restore.
- [ ] **Step 5: Final verification:** `yarn build`, `yarn lint`, `yarn test:unit`, `yarn test:integration:modules`, and the HTTP suites `expenses`, `profit-report`, `sales-report` then `invoices`, `supplier-payments`, `supplier-balances` in batches of at most 3; report counts. Record verified facts (migration file name, service method names) in the spec's assumptions as a separate `docs:` commit.
- [ ] **Step 6: Commit** `feat(backend): show expenses and net profit on the profit page`.
