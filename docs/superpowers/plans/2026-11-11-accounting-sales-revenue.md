# Accounting: Sales and Revenue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Accounting -> Sales page and `GET /admin/sales-report` route showing summary cards, a day/week/month trend and top products, computed from existing Medusa orders.

**Architecture:** A route-level loader reads orders and refund transactions with `query.graph` in pages; a pure module (`sales.ts`) buckets and totals them in integer cents; the route validates the query and returns one JSON report; one admin page renders it. No workflow, no model, no migration.

**Tech Stack:** Medusa v2 (`query.graph`, order module), Zod from `@medusajs/framework/zod`, React + `@medusajs/ui` + react-query in the admin, jest (unit, http integration).

**Spec:** `docs/superpowers/specs/2026-11-10-accounting-sales-revenue-design.md` (binding; the plan argues from it).

## Global Constraints

- All code under `apps/backend`. Branch `feat/accounting-sales`, work in the main checkout; do not touch the running dev server.
- No migration and no write to any table (tests may write fixtures only). Read-only route: GET only.
- Money: plain dollars; accumulate in integer cents with `toCents` from `src/modules/accounting/utils.ts`; return dollars rounded to 2 decimals. Currency `usd` only.
- Included orders: `currency_code = usd`, `canceled_at` null, `status` not `canceled`/`draft`, `created_at` inside the range. Revenue excludes tax.
- Refunds: order transactions with `reference = "refund"`, counted as `abs(amount)` on the transaction's own `created_at` date, only for orders that are not canceled and not drafts, any order age.
- Dates and buckets are UTC. Range inclusive on both ends, default last 30 days ending today, max 366 days. Weeks start Monday and are labeled by the Monday date; months `YYYY-MM`; days `YYYY-MM-DD`. Trend lists every bucket (zero-filled).
- `summary` is the sum of `trend` (cards and table always agree). `top` is 1-50, default 10.
- Zod from `@medusajs/framework/zod` (v4: `z.iso.date()`); export schema and inferred type. All admin requests use `sdk.client.fetch`.
- Admin test lessons: stateful mock server returning fresh objects, wait for rendered signals, flush (`await act(async () => {})`) before "no call" assertions, no effects that reset local form state on refetch, strict numeric parsing, prove key tests against a deliberately broken variant.
- HTTP suites run in batches of at most 3 files (`yarn test:integration:http <file>`); build with `yarn build`, lint with `yarn lint`; both must pass with 0 errors.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push or merge.
- Deviation from the spec's file list (ruling): sales helpers live in a new `src/modules/accounting/sales.ts`, not in `utils.ts`, to keep `utils.ts` focused. It imports `toCents` from `utils.ts`.

## Review Focus

- Totals agree with the Orders page for the same order (Task 1 test).
- A refund recorded inside the range on an order placed before the range lands only in the refund bucket of its own date (Task 3 test).
- Canceled orders and draft orders never count, nor do their refunds (Task 3 test).
- An order at 23:59:59.999 UTC on `to` is in; one at 00:00:00 on `to` + 1 day is out; one at 00:00:00 on `from` is in (Task 2 unit test, Task 3 boundary test).
- A range with no orders returns zeros, a full zero-filled trend and an empty top list, and the page renders it (Tasks 2, 3, 4).
- `0.1 + 0.2` style sums do not drift by a cent (Task 2).

---

### Task 1: Order data loader, verified against a real order

The spec assumes Medusa's computed order totals and the order transactions are readable through `query.graph`. Prove it first; everything else builds on this.

**Files:**
- Create: `src/api/admin/sales-report/load-sales-data.ts`
- Create: `integration-tests/http/sales-report.spec.ts` (this task adds only the data-access describe; Task 3 extends the file)

**Interfaces:**
- Produces (exported from `load-sales-data.ts`):
  ```ts
  export type RawOrder = {
    id: string; created_at: string | Date
    item_subtotal: unknown; discount_subtotal: unknown
    shipping_subtotal: unknown; tax_total: unknown
    items: { variant_id: string | null; product_id: string | null; title: string
             quantity: unknown; subtotal: unknown; discount_subtotal: unknown }[]
  }
  export type RawRefund = { created_at: string | Date; amount: unknown }
  export async function loadSalesData(
    scope: MedusaContainer, range: { from: string; to: string }
  ): Promise<{ orders: RawOrder[]; refunds: RawRefund[] }>
  ```
  `range` values are `YYYY-MM-DD`; the loader converts them to `[from 00:00:00Z, to+1day 00:00:00Z)`.

- [ ] **Step 1: Write the failing test.** In `sales-report.spec.ts` (use the `medusaIntegrationTestRunner` + `createAdminUser` pattern from `supplier-balances.spec.ts` and `createOrderSeeder` from `../fixtures/order`), describe "order data access":
  - `reads computed totals for a placed order`: seed one order, call `loadSalesData(getContainer(), {from: today, to: today})`; expect exactly that order, and `Number(item_subtotal)`, `Number(shipping_subtotal)`, `Number(tax_total)`, `Number(discount_subtotal)` equal the same-named values (or `item_subtotal`/`discount_subtotal`/`shipping_subtotal`/`tax_total`) returned by `GET /admin/orders/:id?fields=+item_subtotal,+discount_subtotal,+shipping_subtotal,+tax_total` (the Orders page source). Items carry `quantity` and `subtotal`.
  - `reads refund transactions`: add a refund with `Modules.ORDER` service `addOrderTransactions({ order_id, amount: -5, currency_code: "usd", reference: "refund", reference_id: "ref_test" })`; expect `refunds` to contain one entry with `Number(amount) === -5`.
  - `excludes canceled orders and other currencies`: cancel a second seeded order (admin cancel route or `cancelOrderWorkflow`); expect it absent from `orders`.
- [ ] **Step 2: Run** `yarn test:integration:http integration-tests/http/sales-report.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `loadSalesData`.** `query.graph` entity `order`, filters `created_at: {$gte, $lt}`, `currency_code: "usd"`, `canceled_at: null`, `status: {$nin: ["canceled","draft"]}`; fields as in `RawOrder` (use `items.*` field paths); pages of 500 ordered by `created_at` then `id`, looping until a short page. Refunds: entity `order_transaction` (confirm the entity name in the running app; if `order_transaction` does not resolve, use `order.transactions.*` from orders with `status` filter instead and say so in the report), filters `reference: "refund"`, `created_at: {$gte, $lt}`, plus the owning order not canceled/draft (`order.status`, `order.canceled_at` fields checked in code). If a field in the spec is not returned by `query.graph`, report BLOCKED with what is available rather than inventing a computation.
- [ ] **Step 4: Run** the same command. Expected: PASS. Also run `yarn build`.
- [ ] **Step 5: Commit** `feat(backend): load orders and refunds for the sales report`.

### Task 2: Pure sales report builder

**Files:**
- Create: `src/modules/accounting/sales.ts`
- Test: `src/modules/accounting/__tests__/sales.unit.spec.ts`

**Interfaces:**
- Consumes: `toCents` from `./utils`; `RawOrder`/`RawRefund` shapes from Task 1 (re-declare minimal structural types in `sales.ts`; the module does not import from `src/api`).
- Produces:
  ```ts
  export type Granularity = "day" | "week" | "month"
  export type SalesReport = {
    range: { from: string; to: string; granularity: Granularity }
    currency_code: "usd"
    summary: SalesTotals                // orders, units + the money figures below
    trend: (SalesTotals & { period: string })[]
    top_products: { variant_id: string | null; product_id: string | null
                    title: string; quantity: number; revenue: number }[]
  }
  // SalesTotals = { orders, units, gross_sales, discounts, net_sales, shipping, tax,
  //                 revenue, refunds, net_revenue, average_order_value }
  export function resolveRange(input: { from?: string; to?: string }, today: Date): { from: string; to: string }
  export function buildSalesReport(input: { orders: SalesOrderInput[]; refunds: SalesRefundInput[]
    from: string; to: string; granularity: Granularity; top: number }): SalesReport
  ```
  `resolveRange` throws `MedusaError` (`INVALID_DATA`) for from after to, a range over 366 days, or an unparsable date; defaults to the 30 days ending `today` (UTC) when both are missing, and fills the missing end from the other (`from` only -> `to` = today, `to` only -> `from` = `to` minus 29 days); the 366-day cap applies after filling.

- [ ] **Step 1: Write failing unit tests**, each with exact expected values:
  - `day buckets are zero-filled` for a 3-day range with one order: 3 periods, empty ones all zeros.
  - `weeks start on Monday and are labeled by that Monday` (range Wed 2026-01-07..Tue 2026-01-20 -> periods `2026-01-05`, `2026-01-12`, `2026-01-19`; an order on Sun 2026-01-11 is in `2026-01-05`).
  - `months span year boundaries` (2025-12-15..2026-02-03 -> `2025-12`, `2026-01`, `2026-02`) and a partial first/last bucket counts only in-range orders.
  - `boundaries`: order at `from`T00:00:00.000Z in; at `to`T23:59:59.999Z in; at `to`+1T00:00:00.000Z out; at `from`-1T23:59:59.999Z out.
  - `cents accumulation`: three orders with `item_subtotal` 0.1, 0.2 and 0.7 sum to `gross_sales` exactly `1`; discounts/shipping/tax likewise.
  - `derived figures`: gross 100, discounts 10, shipping 5, tax 8, refunds 20 -> net_sales 90, revenue 95, net_revenue 75; `net_revenue` may be negative (refund 120 -> -25).
  - `refunds use the absolute value and their own date`: a refund of -30 dated in range counts as 30 in its bucket even though no order is in range.
  - `average_order_value`: revenue 95 over 2 orders -> 47.5; zero orders -> 0.
  - `summary equals the sum of trend` for a mixed fixture (every numeric field).
  - `units` sums item quantities; `top_products`: grouped by `variant_id`; items without a variant grouped by `title`; sorted by revenue desc, then quantity desc, then title asc; `top` limits; revenue is `subtotal - discount_subtotal` per line.
  - `resolveRange`: defaults to 30 days ending today; inverted -> throws; 367 days -> throws, exactly 366 days -> ok; `2026-02-30` -> throws; `from` only / `to` only fills as above.
- [ ] **Step 2: Run** `yarn test:unit src/modules/accounting/__tests__/sales.unit.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `sales.ts` per the signatures. Parse all numbers via `Number(...)` then `toCents`; bucket key function by granularity (UTC); pre-build the period list for the range, then add each order/refund to its bucket (ignore any item outside the range as a guard); compute derived figures from cent sums; summary = sum of trend cents.
- [ ] **Step 4: Run** the unit file; Expected: PASS. Break the Monday rule and the `to`-inclusive boundary once on purpose to prove those tests fail, then restore.
- [ ] **Step 5: Commit** `feat(backend): add the sales report calculation`.

### Task 3: Sales report route and HTTP tests

**Files:**
- Create: `src/api/admin/sales-report/route.ts`, `src/api/admin/sales-report/middlewares.ts`
- Modify: `src/api/middlewares.ts` (register `salesReportMiddlewares`)
- Modify: `integration-tests/http/sales-report.spec.ts`

**Interfaces:**
- Consumes: `loadSalesData` (Task 1), `resolveRange`/`buildSalesReport` (Task 2).
- Produces: `GET /admin/sales-report` returning exactly the `SalesReport` JSON of Task 2; `export const SalesReportQuerySchema` and its inferred type, `export const salesReportMiddlewares: MiddlewareRoute[]` (matcher `/admin/sales-report`, method GET, `validateAndTransformQuery` with `defaults: ["id"]`, not a list). Schema: `from`/`to` optional `z.iso.date()`, `granularity` enum default `day`, `top` `z.coerce.number().int().min(1).max(50).default(10)`.

- [ ] **Step 1: Extend the HTTP spec** with a "GET /admin/sales-report" describe (fixtures helper that seeds orders via `createOrderSeeder`, and sets `created_at` with raw SQL through `ContainerRegistrationKeys.PG_CONNECTION` on `"order"` and `order_transaction` where a test needs a specific date):
  - `returns zeros and a full trend when there are no orders` (range of 3 days: zero summary, 3 zero periods, `top_products` empty).
  - `counts a placed order` with exact `gross_sales`, `shipping`, `tax`, `revenue`, `units`, and `top_products[0]` matching the seeded variant.
  - `excludes canceled orders and drafts, and their refunds`.
  - `ignores orders in another currency` (seed an order row currency `eur` via SQL update).
  - `a refund in range on an order placed before the range counts only in its own bucket`.
  - `a refund dated outside the range is ignored`.
  - `boundary instants`: orders at `from`T00:00:00Z and `to`T23:59:59.999Z counted, at `to`+1 not.
  - `summary equals the sum of the trend` on a multi-day fixture; `granularity=week|month` return the matching period labels.
  - `validation`: `from` after `to`, 367-day range, `2026-02-30`, `granularity=year`, `top=0`, `top=51` -> 400 with message; default query (no params) returns 30 daily periods.
  - `is read-only`: row counts of orders and order transactions identical before and after calls.
  - `requires admin auth`: no headers -> 401.
- [ ] **Step 2: Run** the spec; Expected: new tests FAIL (404).
- [ ] **Step 3: Implement** the route (resolve range with `new Date()`, load, build, `res.json(report)`), middleware and registration.
- [ ] **Step 4: Run** `yarn test:integration:http integration-tests/http/sales-report.spec.ts`; Expected: all PASS. Prove the refund-before-range and canceled-exclusion tests fail against a deliberately broken loader filter, then restore.
- [ ] **Step 5: Run** `yarn build` and `yarn lint` (0 errors); commit `feat(backend): add the sales report route`.

### Task 4: Sales page, tests, final verification

**Files:**
- Create: `src/admin/routes/accounting/sales/page.tsx`
- Create: `src/admin/routes/accounting/sales/__tests__/page.unit.spec.tsx`
- Modify: `src/admin/routes/accounting/types.ts` (add `SalesReport`, `SalesTotals`, `SalesGranularity` types mirroring Task 2)

**Interfaces:**
- Consumes: `GET /admin/sales-report` (Task 3); `formatUsd` from `../../purchases/format`; page and config patterns from `payables/page.tsx` (`defineRouteConfig({ label: "Sales" })`, path nesting under `/accounting`).
- Produces: default-exported `SalesPage`; query key `["admin", "sales-report", from, to, granularity]`.

- [ ] **Step 1: Write failing component tests** (stateful mock server like `payables/__tests__/page.unit.spec.tsx`):
  - `loads the last 30 days by default and shows the cards`: first request has `from`/`to` 29 days apart ending today (UTC) and `granularity: "day"`; cards show the mocked figures formatted as USD (orders, units, gross sales, discounts, shipping, tax, revenue, refunds, net revenue, average order value).
  - `preset buttons refetch`: Last 7 days -> request range 6 days apart; Last 90 -> 89.
  - `changing granularity refetches with it`.
  - `invalid custom range shows a message and sends no request` (from after to; range over 366 days); flush before asserting no call.
  - `shows the trend rows with zeros for empty periods` and the proportional revenue bar width `0%` for zero rows, `100%` for the max row.
  - `shows top products` (title, units, revenue).
  - `shows the previous data while a new range loads` (deferred response).
  - `empty report shows "No orders in this range"` (zero summary, zero trend, empty top).
  - `error state with Retry` calls fetch again and then shows data.
- [ ] **Step 2: Run** `yarn test:unit src/admin/routes/accounting/sales`. Expected: FAIL.
- [ ] **Step 3: Implement** the page: preset buttons (7/30/90), two date inputs, granularity select; client-side range validation (same rules as `resolveRange`) that blocks the request; `useQuery` with `placeholderData: keepPreviousData`, `retry` as the other pages; cards grid, trend table with inline bar (plain `div` width percentage of the max revenue), top products table; loading, error with Retry, empty state. Use `sdk.client.fetch`.
- [ ] **Step 4: Run** the page tests (PASS) and prove the invalid-range test and the previous-data test fail against deliberately broken variants, then restore.
- [ ] **Step 5: Final verification:** `yarn build`, `yarn lint`, `yarn test:unit`, `yarn test:integration:modules`, and the HTTP suites that exist for accounting (`sales-report`, `invoices`, `supplier-payments`, `supplier-balances`) in batches of at most 3; report the counts. Update the spec's Architecture block to name `sales.ts` (the ruling above) and record any verified fact from Task 1 in the spec's assumptions.
- [ ] **Step 6: Commit** `feat(backend): add the sales page` (and a separate `docs:` commit for the spec update).
