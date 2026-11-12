# Accounting Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Accounting landing page (Overview) showing profit figures and a trend for a date range, plus what is owed to suppliers as of today.

**Architecture:** One additive backend change (a `totals` object on `GET /admin/supplier-balances`, computed over all matching rows) and one new admin page that reads the unchanged profit report and the balances endpoint. No tables, migrations or workflows.

**Tech Stack:** Medusa v2 (apps/backend), React admin routes with `@medusajs/ui`, `@tanstack/react-query`, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-13-accounting-overview-design.md`

## Global Constraints

All paths are under `apps/backend` unless stated.

- Money is plain dollars; sums accumulate in integer cents (`toCents` from `src/modules/accounting/utils`) and return as dollars (`cents / 100`).
- Admin requests use `sdk.client.fetch`; page tests mock `../../../../lib/sdk` the way `src/admin/routes/accounting/profit/__tests__/page.unit.spec.tsx` does (jsdom, `text-encoder-polyfill`, `QueryClient` with `retry: false`, `MemoryRouter`).
- Reuse `range.ts` (`PRESETS`, `DEFAULT_PRESET`, `presetRange`, `validateRange`), `formatUsd` from `src/admin/routes/purchases/format`, and the types in `src/admin/routes/accounting/types.ts`. Do not copy them.
- Only GET/POST/DELETE; Zod from `@medusajs/framework/zod` (no schema change is needed here).
- The profit query key is `["admin", "profit-report", from, to, granularity]` and the balances key is `["admin", "supplier-balances", ...]`, so existing invalidations keep working.
- Existing fields of both endpoints keep their meaning; existing tests stay green.
- Run HTTP integration tests in small batches (memory). Commit after each task.

## Review Focus

- Totals cover suppliers beyond the first page and respect the `q` filter (Task 1).
- One section failing never blanks the other (Task 2).
- Overview figures equal the Profit page figures for the same range (Task 2).
- Zero or negative net revenue shows `—` for margin and still renders (Task 2).
- The Accounting click lands on Overview and does not loop (Task 3).

---

### Task 1: Balances totals (backend)

**Files:**
- Modify: `src/api/admin/supplier-balances/summarize-balances.ts`
- Modify: `src/api/admin/supplier-balances/route.ts`
- Test: `src/api/admin/supplier-balances/__tests__/summarize-balances.unit.spec.ts`
- Test: `integration-tests/http/supplier-balances.spec.ts`

**Interfaces:**
- Consumes: `SupplierBalance` rows from `summarizeBalances`.
- Produces: `export type BalanceTotals = { balance_owed: number; overdue_total: number; open_invoices: number; suppliers: number }` and `export const sumBalances = (rows: Pick<SupplierBalance, "balance_owed" | "overdue_total" | "open_invoices">[]): BalanceTotals`, both in `summarize-balances.ts`. The route response gains `totals: BalanceTotals`.

- [ ] **Step 1: Write failing unit tests** in the existing unit spec for `sumBalances`: two suppliers sum correctly; `0.1 + 0.2` owed gives `0.3` (cents accuracy); an empty list returns all zeros with `suppliers: 0`; `suppliers` equals the row count; `open_invoices` is summed.
- [ ] **Step 2: Run** `npx jest src/api/admin/supplier-balances/__tests__/summarize-balances.unit.spec.ts` (with `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules`, as the `test:unit` script does) and see the new tests fail.
- [ ] **Step 3: Implement `sumBalances`** in `summarize-balances.ts` summing `toCents` of each money field and dividing by 100.
- [ ] **Step 4: Wire the route.** In `route.ts` compute `totals = sumBalances(matching)` on the rows after the `q` filter and before `slice`, and add `totals` to the JSON response next to `count`.
- [ ] **Step 5: Add HTTP tests** to `integration-tests/http/supplier-balances.spec.ts` in its existing seeding style: (a) more suppliers than `limit` — `totals.suppliers === count` and `totals.balance_owed` equals the sum over all suppliers, not the page; (b) `q` narrows `totals` to the matching suppliers; (c) no posted invoices returns zeros; (d) existing assertions stay green. Prove (a) fails if `totals` is computed from the sliced page.
- [ ] **Step 6: Run** the unit spec and `yarn test:integration:http -- supplier-balances` — all pass. Run `npx tsc --noEmit -p .` or `yarn build` for types.
- [ ] **Step 7: Commit** `feat(backend): add totals to the supplier balances response`.

---

### Task 2: Overview page — profit section

**Files:**
- Create: `src/admin/routes/accounting/overview/page.tsx`
- Create: `src/admin/routes/accounting/overview/__tests__/page.unit.spec.tsx`
- Modify: `src/admin/routes/accounting/types.ts`

**Interfaces:**
- Consumes: `ProfitReport` (types.ts), range helpers, `formatUsd`.
- Produces: `export type SupplierBalanceTotals = { balance_owed: number; overdue_total: number; open_invoices: number; suppliers: number }` in `types.ts`; the default export `OverviewPage` and `config = defineRouteConfig({ label: "Overview" })` in `overview/page.tsx`. Structure the page as `OverviewPage` composing two section components in the same file, `ProfitSection` and `OwedSection` (Task 3 fills `OwedSection`; in this task render it as an empty placeholder element).

- [ ] **Step 1: Write failing tests** (mocked `sdk.client.fetch` routed by URL, balances route returns a never-resolving or empty promise in this task):
  - Cards render Net revenue, Gross profit, Expenses, Net profit and Net margin from `summary`, formatted like the Profit page (`formatUsd`; margin `x.y%`).
  - Default request is `/admin/profit-report` with `from`/`to` of the last 30 days (`presetRange(30)`) and `granularity: "day"`.
  - Clicking "Last 7 days" refetches with the 7-day range; changing Group by to Month refetches with `granularity: "month"`.
  - Trend table lists period, net revenue and net profit per row; the net profit bar width is proportional to the largest net profit and `0%` for zero or negative.
  - `net_margin_pct: null` renders `—`; `net_revenue: 0` with a null margin still renders the page.
  - An invalid range (from after to) shows the validation message and makes no profit request (flush before asserting).
  - Error shows a message and Retry refetches; loading shows a loading indicator; previous data stays visible while a new range loads.
  - Empty state "No orders or expenses in this range" when `orders`, `net_revenue`, `cogs`, `expenses` are 0 and `by_product` and `expenses_by_category` are empty.
  - Parity: for one fixed mocked report, the five card values equal what `ProfitPage` renders for the same report (import `ProfitPage` from `../../profit/page` and compare the displayed text of the matching cards).
- [ ] **Step 2: Run** the spec and see it fail (module missing).
- [ ] **Step 3: Implement the page** following `profit/page.tsx` (same filter row, query key, `keepPreviousData`, `enabled: rangeError === null`). Bars use net profit only, scale is the largest net profit in the range (minimum 0). Heading "Overview"; the profit section is its own `Container`/section so a failure stays inside it.
- [ ] **Step 4: Run** the page spec — all pass; also run the Profit page spec to confirm it is unchanged.
- [ ] **Step 5: Commit** `feat(backend): add the accounting overview page with profit figures`.

---

### Task 3: Owed section, landing redirect, menu

**Files:**
- Modify: `src/admin/routes/accounting/overview/page.tsx`
- Modify: `src/admin/routes/accounting/page.tsx`
- Modify: `src/admin/routes/accounting/overview/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `GET /admin/supplier-balances` response `{ balances, count, offset, limit, totals }` (Task 1); `SupplierBalanceTotals` (Task 2).
- Produces: nothing further.

- [ ] **Step 1: Write failing tests** in the overview spec:
  - `OwedSection` calls `/admin/supplier-balances` with `limit: 1` (only `totals` is used) and renders Total owed, Overdue and Open invoices from `totals`, labelled "As of today".
  - It contains a link to `/accounting/payables`.
  - Balances failing shows an error with Retry in that section while the profit cards still render; profit failing leaves the owed cards rendered (both directions).
  - Changing the date range does not refetch balances (call count stays 1).
  - Zero totals render `$0.00` cards, no error.
  - `config.label` is `"Overview"` and the `/accounting` landing: render `AccountingPage` from `../../page` inside a `MemoryRouter` with routes `/accounting` and `/accounting/overview` and assert it lands on the overview route without looping.
- [ ] **Step 2: Run** and see them fail.
- [ ] **Step 3: Implement `OwedSection`** with query key `["admin","supplier-balances","totals"]`, independent loading/error/Retry, a "Payables" link using `react-router-dom` `Link`. Change `accounting/page.tsx` to `<Navigate to="/accounting/overview" replace />`.
- [ ] **Step 4: Run** the overview spec and the payables and profit specs — all pass.
- [ ] **Step 5: Run** `yarn build` and `npx medusa lint` (0 errors) and the full `yarn test:unit`.
- [ ] **Step 6: Commit** `feat(backend): show money owed on the overview and make it the accounting landing page`.
