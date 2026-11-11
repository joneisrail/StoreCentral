# Accounting: Profit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Accounting -> Profit page and `GET /admin/profit-report` route showing net revenue, cost of goods sold, gross profit and margin by day/week/month and by product, using the running average purchase cost as of each sale.

**Architecture:** The existing `loadSalesData` supplies orders and refunds; a new loader reads purchases with receipts; a pure `profit.ts` builds the sales report (for revenue, so figures match Sales exactly), computes landed costs and running averages, and adds cost and profit per bucket and per product; a thin route validates the query; one admin page renders it. No workflow, model or migration.

**Tech Stack:** Medusa v2 (`query.graph`, purchase and order modules), Zod from `@medusajs/framework/zod`, React + `@medusajs/ui` + react-query in the admin, jest (unit, http integration).

**Spec:** `docs/superpowers/specs/2026-11-12-accounting-profit-design.md` (binding). Builds on `2026-11-10-accounting-sales-revenue-design.md` and its code (`sales.ts`, `load-sales-data.ts`, the Sales page).

## Global Constraints

- All code under `apps/backend`. Branch `feat/accounting-profit`, main checkout; do not touch the running dev server; never push or merge.
- No migration and no write to any table (tests may write fixtures only). Route is GET only.
- Money: plain dollars; accumulate in integer cents with `toCents` from `src/modules/accounting/utils.ts`; return dollars rounded to 2 decimals. Currency `usd` only. Orders, refunds, range, UTC and buckets are exactly as in the Sales code (reuse, do not reimplement).
- Landed unit cost of a purchase line: `subtotal = sum(quantity * unit_cost)` over the purchase's lines, `extras = shipping_cost + tax + other_cost`; if `subtotal > 0` then `unit_cost * (1 + extras / subtotal)`; else if total quantity > 0 then `unit_cost + extras / total_quantity`; else `unit_cost`.
- Cost events per variant come from receipt lines (`received_at`, `quantity`, landed cost of the referenced purchase line), ordered by `received_at` then id. Average cost at time `t` = total landed cost / total quantity over events with `received_at <= t`; none -> the sale is uncosted. Line cost = `round(quantity * average cost in cents)`; uncosted lines add no cost, their units count in `units_without_cost`, their revenue still counts.
- `net_revenue` is taken from the sales report for the same range (never recomputed); `gross_profit = net_revenue - cogs`; `margin_pct = gross_profit / net_revenue * 100` to one decimal, `null` when `net_revenue <= 0`, computed from summed cents. Summary is the sum of the trend.
- By product: grouped by `variant_id` (lines with no variant by `title`); `revenue` = line subtotal minus line discount subtotal; sorted by `gross_profit` desc, `units` desc, title asc; limited to `top` (1-50, default 10).
- Same query as Sales: `from`, `to` (`YYYY-MM-DD`, UTC, inclusive, default last 30 days, max 366), `granularity` (`day` default, `week`, `month`), `top`. Zod from `@medusajs/framework/zod`; export schema and inferred type. All admin requests use `sdk.client.fetch`.
- Admin test lessons: stateful mock server returning fresh objects, wait for rendered signals, flush (`await act(async () => {})`) before "no call" assertions, no effects that reset local form state on refetch, strict date parsing, prove key tests against deliberately broken variants.
- HTTP suites run in batches of at most 3 files (`yarn test:integration:http <file>`); `yarn build` and `yarn lint` must pass with 0 errors.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A sale before the first receipt is uncosted, not costed at zero (Tasks 2, 3).
- A purchase received after a sale never changes that sale's cost (Tasks 2, 3).
- Two purchases of one variant at different costs average by quantity (Task 2).
- Purchase shipping, tax and other costs are in the cost, exactly (Tasks 2, 3).
- `net_revenue` equals the sales-report figure for the same range (Task 3).
- Zero or negative net revenue gives a `null` margin and a rendered page (Tasks 2, 4).
- `0.1 + 0.2` style sums do not drift by a cent (Task 2).

---

### Task 1: Share the bucketing and date-range helpers

Pure refactor so Profit can reuse Sales code. No behavior change.

**Files:**
- Modify: `src/modules/accounting/sales.ts` (export `bucketKey`, `parseDay`, `isoDay`, `cents`, `DAY_MS`, and keep every existing export)
- Create: `src/admin/routes/accounting/range.ts` (`presetRange(days)`, `parseDay(value)`, `validateRange(from, to)`, `isoDay(ms)`, and the constants they need: `PRESETS`, `DEFAULT_PRESET`, `MAX_RANGE_DAYS`, `DAY_MS`)
- Modify: `src/admin/routes/accounting/sales/page.tsx` (import them from `../range`; delete the local copies)
- Test: existing `sales.unit.spec.ts` and `sales/__tests__/page.unit.spec.tsx` must stay green and unchanged

**Interfaces:**
- Produces (backend): from `sales.ts` — `bucketKey(ms: number, granularity: Granularity): string`, `parseDay(value: string, label: string): number`, `isoDay(ms: number): string`, `cents(value: unknown): number`, `DAY_MS: number`.
- Produces (admin): from `range.ts` — the same signatures the Sales page uses today (`validateRange(from, to): string | null`, `presetRange(days): { from: string; to: string }`).

- [ ] **Step 1: Run** `yarn test:unit src/modules/accounting/__tests__/sales.unit.spec.ts` and the Sales page spec; record they pass (baseline).
- [ ] **Step 2: Add `export`** to the five `sales.ts` symbols; move the admin helpers verbatim into `range.ts` and import them in `sales/page.tsx`.
- [ ] **Step 3: Re-run** both specs plus `yarn build`; expected: identical pass counts, 0 errors.
- [ ] **Step 4: Commit** `refactor(backend): share sales bucketing and range helpers`.

### Task 2: Pure profit report builder

**Files:**
- Create: `src/modules/accounting/profit.ts`
- Test: `src/modules/accounting/__tests__/profit.unit.spec.ts`

**Interfaces:**
- Consumes: `buildSalesReport`, `bucketKey`, `parseDay`, `cents`, `DAY_MS`, `Granularity`, `SalesOrderInput`, `SalesRefundInput` from `./sales`; `toCents` from `./utils`.
- Produces:
  ```ts
  export type CostPurchase = {
    shipping_cost: unknown; tax: unknown; other_cost: unknown
    items: { id: string; variant_id: string | null; quantity: unknown; unit_cost: unknown }[]
    receipts: { id: string; received_at: string | Date
                items: { purchase_item_id: string; quantity: unknown }[] }[]
  }
  export type CostEvent = { at: number; quantity: number; cost_cents: number } // total landed cents of the receipt line
  export function buildCostEvents(purchases: CostPurchase[]): Map<string, CostEvent[]> // by variant_id, ordered
  export function averageUnitCostCents(events: CostEvent[] | undefined, atMs: number): number | null
  export type ProfitTotals = { orders: number; units: number; net_revenue: number; cogs: number
    gross_profit: number; margin_pct: number | null; units_without_cost: number }
  export type ProfitReport = {
    range: { from: string; to: string; granularity: Granularity }
    currency_code: "usd"; summary: ProfitTotals
    trend: (ProfitTotals & { period: string })[]
    by_product: { variant_id: string | null; product_id: string | null; title: string; units: number
                  revenue: number; cogs: number; gross_profit: number; margin_pct: number | null
                  units_without_cost: number }[]
  }
  export function buildProfitReport(input: { orders: SalesOrderInput[]; refunds: SalesRefundInput[]
    purchases: CostPurchase[]; from: string; to: string; granularity: Granularity; top: number }): ProfitReport
  ```
  `buildProfitReport` calls `buildSalesReport` (with `top: 1`) for `orders`, `units`, `net_revenue` per bucket and in total, then adds cost, profit and margin; it never recomputes revenue.

- [ ] **Step 1: Write failing unit tests** with exact values:
  - `landed cost spreads extras by line value`: purchase lines 2 x $10 and 1 x $30 (subtotal 50), shipping 5 + tax 3 + other 2 (extras 10) -> factor 1.2, landed $12 and $36.
  - `landed cost with a zero subtotal spreads extras per unit` (unit costs 0, quantity 4, extras 8 -> $2 each); `landed cost with no extras and no quantity falls back to unit cost`.
  - `average cost across two purchases of one variant`: 10 units landed $2 and 30 units landed $4 -> $3.50 average at a later time.
  - `average uses only receipts at or before the sale time`: a receipt at exactly the sale instant counts; one 1 ms later does not.
  - `a later higher-priced purchase does not change an earlier sale's cost`.
  - `a sale before the first receipt is uncosted`: no cost, `units_without_cost` equals the units, its revenue still counts; a variant-less line is uncosted.
  - `line cost rounds once per line` (e.g. quantity 3 x average 33.333... cents -> 100 cents) and `0.1 + 0.2 + 0.7` style sums give exact cents.
  - `net revenue matches buildSalesReport` for the same inputs (trend and summary, every bucket).
  - `gross profit may be negative`; `margin_pct` is one-decimal percent, `null` when net revenue is 0 or negative, and the summary margin comes from summed cents (differs from the mean of bucket margins in a crafted case).
  - `summary equals the sum of the trend` for orders, units, net_revenue, cogs, gross_profit, units_without_cost.
  - `by_product` groups by variant (variant-less lines by title), revenue = subtotal - discount, ordering gross_profit desc then units desc then title asc, `top` limit, per-product `units_without_cost`.
  - `weeks and months` bucket cost with the Sales rules (a Sunday cost lands in the Monday-labeled week).
- [ ] **Step 2: Run** `yarn test:unit src/modules/accounting/__tests__/profit.unit.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `profit.ts` per the signatures and Global Constraints. Per variant, pre-compute cumulative `(quantity, cost_cents)` arrays so `averageUnitCostCents` is a binary search or a linear scan over at most a few thousand events; receipt lines whose `purchase_item_id` is unknown or whose purchase line has no `variant_id` are ignored.
- [ ] **Step 4: Run** the unit file; expected PASS. Prove two tests fail against deliberate breaks (use `<` instead of `<=` for the receipt time; skip the extras share), then restore.
- [ ] **Step 5: Commit** `feat(backend): add the profit report calculation`.

### Task 3: Cost loader, profit route and HTTP tests

**Files:**
- Create: `src/api/admin/profit-report/load-cost-data.ts`, `route.ts`, `middlewares.ts`
- Modify: `src/api/middlewares.ts` (register `profitReportMiddlewares`)
- Create: `integration-tests/http/profit-report.spec.ts`; if the order/refund helpers in `sales-report.spec.ts` are local, extract them to `integration-tests/fixtures/sales-orders.ts` and import them from both specs (the sales spec must stay green)

**Interfaces:**
- Consumes: `loadSalesData` (existing), `resolveRange` and `buildProfitReport` (Tasks 1-2).
- Produces:
  ```ts
  export async function loadCostData(scope: MedusaContainer, endExclusive: Date): Promise<CostPurchase[]>
  // query.graph entity "purchase": fields shipping_cost, tax, other_cost, items.id/variant_id/quantity/unit_cost,
  // receipts.id/received_at, receipts.items.purchase_item_id/quantity; pages of 200 purchases ordered by id;
  // keeps only purchases that have at least one receipt with received_at < endExclusive
  ```
  `GET /admin/profit-report` returns the `ProfitReport` JSON of Task 2; `ProfitReportQuerySchema` (same shape as `SalesReportQuerySchema`), `profitReportMiddlewares: MiddlewareRoute[]` (matcher `/admin/profit-report`, GET).

- [ ] **Step 1: Write the failing HTTP spec** (runner and admin setup as in `sales-report.spec.ts`; create purchases and receipts through the existing purchase routes — read `integration-tests/http/purchases.spec.ts` for the create/order/receive calls — and set `received_at` with parameterized SQL on `purchase_receipt`; create dated orders as `sales-report.spec.ts` does):
  - `verifies the cost data is readable`: loader returns the seeded purchase with its receipts and lines (confirms entity and field names; if `query.graph` cannot read a field, report BLOCKED with what is available).
  - `exact cost and profit for one order`: purchase 10 x $4 with shipping $10 (landed $5), received before the order; order sells 2 at $20 -> `cogs` 10, `net_revenue` equals the sales-report figure, `gross_profit` and `margin_pct` exact.
  - `a sale before the first receipt is uncosted` (cogs 0, `units_without_cost` equal to units, warning figure present).
  - `a later receipt at a higher price leaves an earlier sale's profit unchanged`.
  - `two purchases average by quantity` at a sale after both.
  - `purchase extras (shipping, tax, other) are in the cost`.
  - `canceled orders excluded` and `net_revenue equals the sales-report net_revenue` for the same range on a mixed fixture.
  - `by_product` ordering and values; `top` limits.
  - `validation`: inverted range, 367 days, `granularity=year`, `top=0`, `top=51` -> 400.
  - `no data returns zeros, a full zero-filled trend, empty by_product`; `is read-only` (row counts of orders, purchases, receipts unchanged); `requires admin auth` (401).
- [ ] **Step 2: Run** `yarn test:integration:http integration-tests/http/profit-report.spec.ts`; expected FAIL (404).
- [ ] **Step 3: Implement** the loader, route (resolve range with `new Date()`, `loadSalesData`, `loadCostData(scope, end of range)`, `buildProfitReport`, `res.json`), middleware and registration. Keep the route thin.
- [ ] **Step 4: Run** the new spec and `integration-tests/http/sales-report.spec.ts`; expected all PASS. Prove the uncosted-sale and later-receipt tests fail against a deliberately broken loader filter, then restore.
- [ ] **Step 5: Run** `yarn build` and `yarn lint` (0 errors); commit `feat(backend): add the profit report route`.

### Task 4: Profit page, tests and final verification

**Files:**
- Create: `src/admin/routes/accounting/profit/page.tsx`, `src/admin/routes/accounting/profit/__tests__/page.unit.spec.tsx`
- Modify: `src/admin/routes/accounting/types.ts` (add `ProfitReport`, `ProfitTotals` mirroring Task 2)

**Interfaces:**
- Consumes: `GET /admin/profit-report` (Task 3); `presetRange`, `validateRange`, `PRESETS`, `DEFAULT_PRESET` from `../range` (Task 1); `formatUsd` from `../../purchases/format`; the Sales page (`sales/page.tsx`) as the pattern for filters, cards, trend bars, states and `defineRouteConfig({ label: "Profit" })`.
- Produces: default-exported `ProfitPage`; query key `["admin", "profit-report", from, to, granularity]`.

- [ ] **Step 1: Write failing component tests** (stateful mock server like the Sales page spec):
  - `loads the last 30 days by default and shows the cards` (net revenue, cost of goods, gross profit, margin, units without cost as exact USD/percent text); margin `null` renders `—`.
  - `shows the warning only when units_without_cost > 0`, with the exact sentence from the spec.
  - `preset buttons and granularity refetch with the right params`.
  - `invalid custom range shows a message and sends no request` (flush before asserting).
  - `trend rows show cost, profit and margin; the gross-profit bar is 100% for the max row, 0% for zero or negative`.
  - `by product table shows title, units, revenue, cost, profit, margin`.
  - `keeps previous data while a new range loads`; `empty report shows "No orders in this range"`; `error state with Retry`.
- [ ] **Step 2: Run** `yarn test:unit src/admin/routes/accounting/profit`. Expected FAIL.
- [ ] **Step 3: Implement** the page. Prove the invalid-range and previous-data tests fail against deliberately broken variants, then restore.
- [ ] **Step 4: Final verification:** `yarn build`, `yarn lint`, `yarn test:unit`, `yarn test:integration:modules`, and the HTTP suites `profit-report`, `sales-report`, `invoices` (then `supplier-payments`, `supplier-balances`) in batches of at most 3; report the counts.
- [ ] **Step 5: Commit** `feat(backend): add the profit page`; in a separate `docs:` commit record any verified fact from Task 3 (purchase entity fields) in the spec's assumptions.
