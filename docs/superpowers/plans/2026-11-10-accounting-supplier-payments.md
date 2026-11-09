# Accounting: Supplier Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record payments against posted supplier invoices, show paid / balance / payment status and overdue on invoices, show what is owed per supplier, and close the locking gaps found in the piece 1 review.

**Architecture:** A Payment model joins the existing `accounting` module, linked to its invoice; record and void workflows run under the invoice's existing status lock; invoice responses gain computed payment fields; new admin routes for payments and supplier balances; admin pages for Payments and Payables and a payments section on the invoice page. Purchase cancel, invoice post and invoice update are hardened.

**Tech Stack:** Medusa v2 (DML, `MedusaService`, workflows, `query.graph`, links, locking module), Zod from `@medusajs/framework/zod`, Medusa admin extensions (React, `@medusajs/ui`, `sdk.client.fetch`), jest, `medusaIntegrationTestRunner`, `moduleIntegrationTestRunner`.

**Spec:** `docs/superpowers/specs/2026-11-10-accounting-supplier-payments-design.md` (builds on `2026-11-06-accounting-supplier-invoices-design.md`)

## Global Constraints

Paths are relative to `apps/backend/`; run commands from there.

- Zod only from `@medusajs/framework/zod`. Only GET and POST routes. Every mutation goes through a workflow with compensation. Errors are `MedusaError`.
- Migrations are generated with `npx medusa db:generate accounting`, never hand-written.
- Money is plain dollars (`model.bigNumber()`), serialized as `number`. All balance and overpay comparisons are done in integer cents (`Math.round(value * 100)`), never with floating-point `>`. Payment amounts have at most 2 decimals.
- Lock order everywhere: invoice status lock, then invoice-number lock, then purchase lock (`invoiceStatusLockKey`, `invoiceLockKey`, `purchaseLockKey`). Record payment, void payment and void invoice take only the invoice status lock; post invoice takes status then purchase; purchase cancel takes only the purchase lock.
- The accounting module imports nothing from the purchase or supplier modules' services; routes, mappers and workflow steps may read other modules via `query.graph` and pure helpers.
- Payments and invoices never change stock or purchases' quantities.
- Admin pages use `sdk.client.fetch` only, show toasts for mutation results, clamp pagination when the count shrinks, show a retryable error state, disable buttons while a request is in flight, and invalidate query prefixes `["admin","invoices"]`, `["admin","supplier-payments"]`, `["admin","supplier-balances"]`, `["admin","purchase-invoices"]` after mutations. Lessons from earlier reviews apply to every page test: stateful mock server with fresh objects per response, wait for rendered signals, flush (`await act(async () => {})`) before "no call" assertions, no effect that resets local form state on refetch, strict numeric parsing (never treat unreadable input as cleared or 0), and prove key tests against deliberately broken variants.
- Out of scope: refunds/credit notes, splitting a payment across invoices, reconciliation, sales, profit.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Branch `feat/accounting-payments`.
- Test commands: `yarn test:unit <path>`, `yarn test:integration:modules <path>`, `yarn test:integration:http <path>`. Do not run `npx medusa db:migrate` against the dev database except as reported in Task 9, and never touch the dev server on port 9000.

## Review Focus

- Two simultaneous payments that together exceed the balance: exactly one wins (Task 2).
- A payment racing an invoice void: never a voided invoice with a live payment (Task 3).
- A purchase cancel racing an invoice post: never a posted invoice on a cancelled purchase (Task 4).
- 0.1 + 0.2 style sums neither strand a cent nor allow overpaying by a cent (Task 1).
- A voided payment counts nowhere: balance, status, payables (Tasks 1, 3, 6).

---

### Task 1: Payment model, link, pure helpers

**Files:**
- Create: `src/modules/accounting/models/payment.ts`, `src/links/payment-invoice.ts`, generated migration under `src/modules/accounting/migrations/`
- Modify: `src/modules/accounting/service.ts` (register Payment), `src/modules/accounting/utils.ts`
- Test: `src/modules/accounting/__tests__/accounting-utils.unit.spec.ts`, `src/modules/accounting/__tests__/payment-module.spec.ts`

**Interfaces:**
- Produces model Payment: `id`, `display_id` autoincrement, `invoice_id` text, `supplier_id` text, `amount` bigNumber, `paid_at` dateTime, `method` enum `bank_transfer|cash|card|cheque|other`, `reference` nullable text, `note` nullable text, `status` enum `recorded|void` default `recorded`, `voided_at` nullable dateTime, `currency_code` default "usd". Service methods `createPayments`, `listPayments`, `retrievePayment`, `updatePayments`, `deletePayments`.
- Produces in `utils.ts`: `formatPaymentReference(displayId: number): string` (`PAY-0001`); `toCents(value: number): number`; `isValidPaymentAmount(amount: number): boolean` (finite, > 0, at most 2 decimals, compared in cents so `0.1+0.2` style inputs are judged by their cent value only when they are exactly representable to 2 decimals); `calculatePaidTotal(payments: {amount:number; status:string}[]): number` (non-void only, 2 decimals); `calculateBalance(total: number, payments): number`; `getPaymentStatus(input: {invoice_status: string; total: number; paid_total: number}): "unpaid"|"partially_paid"|"paid"|null` (null unless posted); `isOverdue(input: {invoice_status: string; due_date: string|Date|null; balance: number}, today: Date): boolean` (posted, due date strictly before today's UTC date, balance > 0 in cents).
- Link `payment-invoice.ts`: Payment (`isList: true`) to Invoice, same style as `src/links/invoice-purchase.ts`.

- [ ] **Step 1: Write the failing tests.** Unit: reference `PAY-0007`; `isValidPaymentAmount` accepts 0.01 and 12.5, rejects 0, -1, 1.005, NaN; `calculatePaidTotal` ignores void payments and equals 0.3 for payments 0.1 and 0.2; `calculateBalance(10, [3.33, 3.33, 3.34])` is 0; `getPaymentStatus`: draft/void invoice -> null, posted with paid 0 -> unpaid, partial -> partially_paid, exact -> paid, voided payments do not count; `isOverdue`: due yesterday with balance -> true, due today -> false, no due date -> false, balance 0 -> false, draft -> false (use a fixed `today`). Module: defaults (`status` recorded, `currency_code` usd), `method` enum rejects an unknown value, status update to void persists with `voided_at`.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/modules/accounting`, `yarn test:integration:modules src/modules/accounting`.
- [ ] **Step 3: Implement** the model, service registration, utils and the link, then `npx medusa db:generate accounting`.
- [ ] **Step 4: Run Step 2 commands, expect PASS;** `npx tsc --noEmit -p .` and `yarn lint` clean.
- [ ] **Step 5: Commit** — `feat(backend): add payment model and payment helpers`.

---

### Task 2: Record, list, retrieve and void payments

**Files:**
- Create: `src/workflows/record-payment.ts`, `src/workflows/void-payment.ts`, steps `src/workflows/steps/record-payment.ts`, `void-payment.ts`; `src/api/admin/supplier-payments/route.ts`, `[id]/route.ts`, `[id]/void/route.ts`, `middlewares.ts`, `map-payment.ts`, `retrieve-admin-payment.ts`
- Modify: `src/api/middlewares.ts` (spread `paymentMiddlewares`)
- Test: `integration-tests/http/payments.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers and model; `invoiceStatusLockKey`; invoice mapper helpers in `src/api/admin/invoices/`.
- Produces `RecordPaymentSchema` (`invoice_id`, `amount` number, `paid_at` `YYYY-MM-DD` via `z.iso.date()`, `method` enum, `reference?`, `note?`; `reference`/`note` trimmed, blank omitted) and `ListPaymentsQuerySchema` (`invoice_id`, `supplier_id`, `status`, `method`, `q`, `limit` 1..100 default 20, `offset`), exported with inferred types.
- Produces `mapPayment(row, extras)` -> `{ id, reference (PAY-0001), invoice: { id, reference, invoice_number } | null, supplier: { id, name } | null, amount, paid_at (YYYY-MM-DD), method, payment_reference, note, status, voided_at, created_at }` (the field named `reference` is the PAY- reference; the user-entered one is `payment_reference`).
- Produces routes: `POST /admin/supplier-payments` -> `{ payment }`; `GET /admin/supplier-payments` -> `{ payments, count, offset, limit }` (newest first, `id` tiebreak, supplier names and invoice references batched, `q` matches `payment_reference` case-insensitively with `%`/`_` literal and whitespace ignored); `GET /admin/supplier-payments/:id` -> `{ payment }`; `POST /admin/supplier-payments/:id/void` -> `{ payment }`.

- [ ] **Step 1: Write the failing HTTP tests** (build suppliers, ordered purchases, posted invoices through the real routes as `invoices.spec.ts` does):
  - Record against a posted invoice: 200, `reference` `PAY-0001`, supplier from the invoice, amount stored; response numbers are numbers.
  - 400s: draft invoice, void invoice, unknown invoice (404), amount 0 / negative / 3 decimals / over the balance (message names the balance), exact balance accepted, blank method, bad date; a second payment is limited by the remaining balance; unauthenticated 401.
  - Cents: invoice total 0.30 with payments 0.10 then 0.20 -> second accepted and balance 0; a third 0.01 refused.
  - Race: `Promise.all` of two payments each for 60% of the balance -> exactly one 200 and one 400.
  - Void payment: 200, status void with `voided_at`; voiding twice -> 400 and `voided_at` unchanged; voiding frees the balance (a new payment up to the full balance is accepted); unknown id 404.
  - List: each filter, `q` escaping (`%`, `_`), whitespace-only `q` ignored, pagination count and stable order; detail 404.
  - Failure injection (jest spy on the accounting service, restored in `finally`): a failure after the payment row is created but before the link is written leaves no payment row behind.
  - Stock levels unchanged.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:integration:http integration-tests/http/payments.spec.ts`.
- [ ] **Step 3: Implement.** Record step: read the invoice, check status and cents-based balance, create the payment — all inside `locking.execute([invoiceStatusLockKey(invoice_id)], ...)`; snapshot/undo deletes the row. Void step: same lock, status check, set `void`/`voided_at`, undo restores. Workflow links the payment to the invoice with `createRemoteLinkStep` (key names per `defineLink`; verify against an existing link usage). Reuse `escapeLike`.
- [ ] **Step 4: Run Step 2 command, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add record, list and void payment`.

---

### Task 3: Payment fields on invoices, payments in detail, void-invoice guard

**Files:**
- Modify: `src/api/admin/invoices/map-invoice.ts`, `retrieve-admin-invoice.ts`, `route.ts` (list), `[id]/route.ts` (detail), `middlewares.ts` (list query), `src/workflows/steps/void-invoice.ts`
- Test: `integration-tests/http/invoices.spec.ts`, `integration-tests/http/payments.spec.ts`, `src/api/admin/invoices/__tests__/map-invoice.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `mapPayment`.
- Produces: every invoice object (list and detail) gains `paid_total`, `balance`, `payment_status` (`unpaid|partially_paid|paid|null`), `overdue` (boolean); `GET /admin/invoices/:id` also returns `payments` (newest first, `mapPayment` shape); the list query gains `payment_status` filter (`unpaid|partially_paid|paid|overdue`). Payments of all invoices on a page are read in ONE query (no per-row query). For the `payment_status` filter, which is computed, load the posted invoices matching the other filters with their payments, filter and sort in memory, then paginate in memory (state this in a comment).
- Produces void-invoice rule: inside the existing status lock, count `recorded` payments of the invoice; if any, throw NOT_ALLOWED "Invoice <number> has payments; void the payments first" (list how many).

- [ ] **Step 1: Write the failing tests.** Unit: mapper computes the four fields from invoice + payments (void payments ignored; draft -> status null, overdue false). HTTP: list/detail fields for unpaid, part paid, paid, a voided payment not counting; `overdue` true for a past due date with a balance and false once paid; the `payment_status` filter for each value including `overdue`, combined with `supplier_id`, with correct `count` and pagination; detail includes `payments` newest first; 60 payments on one invoice are all counted (no default-take truncation: use `pagination: { take: null }` like the invoice siblings query); void invoice refused with a live payment (400, message names the count) and allowed after that payment is voided; race: `Promise.all` of a payment and a void on one posted invoice — never ends with a void invoice that has a live payment (final state consistent, at most one of the two succeeds when the payment succeeds first the void is 400, when the void succeeds first the payment is 400); void invoice with no payments unchanged.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add payment status to invoices and guard invoice void`.

---

### Task 4: Purchase cancel and invoice post locking

**Files:**
- Modify: `src/workflows/steps/cancel-purchase.ts`, `src/workflows/steps/post-invoice.ts`
- Test: `integration-tests/http/purchases.spec.ts`, `integration-tests/http/invoices.spec.ts`

**Interfaces:**
- Consumes: `purchaseLockKey` (`src/modules/purchase/utils.ts`), `invoiceStatusLockKey`.
- Produces: cancel step refuses (NOT_ALLOWED) when the purchase has any invoice whose status is not `void`, naming the first blocking invoice's reference and number; the check runs inside the existing purchase lock and reads invoices with `query.graph` (entity `invoice`, `filters: { purchase_id, status: { $ne: "void" } }` or an equivalent that works with `query.graph`; no import of the accounting service into the purchase workflow). Post takes `[invoiceStatusLockKey(id)]` then, inside that lock, nests `locking.execute([purchaseLockKey(purchase_id)], ...)` for the purchase status re-check and the write (status lock first, purchase lock second, as documented in the spec; add a comment stating the order).

- [ ] **Step 1: Write the failing tests:** cancel refused with a draft invoice and with a posted invoice (message names the invoice), allowed when all invoices are void or none exist, existing cancel behaviours unchanged (purchase with received goods still refused, etc.); post then cancel -> cancel 400; cancel then post -> post 400 (existing); race: `Promise.all` of cancel and post on an ordered purchase with a draft invoice -> never the end state "posted invoice on a cancelled purchase" (assert exactly one succeeds and the final states are consistent, stable over 3 runs); lock-order comment present (grep in a unit test is NOT required).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** also run `yarn test:integration:http integration-tests/http/purchases.spec.ts integration-tests/http/invoices.spec.ts` in full; tsc and lint clean.
- [ ] **Step 5: Commit** — `fix(backend): refuse purchase cancel with live invoices and lock post by purchase`.

---

### Task 5: Update-invoice link writes inside the locked step

**Files:**
- Modify: `src/workflows/update-invoice.ts`, `src/workflows/steps/update-invoice.ts`
- Test: `integration-tests/http/invoices.spec.ts`

**Interfaces:**
- Consumes: the link service (`ContainerRegistrationKeys.LINK` or `Modules`-level link API as used by `createRemoteLinkStep`/`dismissRemoteLinkStep` internally — read how those steps call it and mirror it).
- Produces: the dismiss and create of the replaced lines' item links happen inside the locked `write()` of `updateInvoiceStep`, with their own undo in the existing catch/restore path; the two link steps are removed from the workflow. After a failure at any point the invoice, its lines, their ids and their links are exactly as before, and a concurrent post can never have its content rewritten.

- [ ] **Step 1: Write the failing tests:** (existing Task 4 failure-injection tests must keep passing); new: injected failure while writing the new item links leaves old lines, header and the OLD links intact (query the link table); a post that lands while the update is waiting on the lock is never overwritten (post wins, update returns 400 locked, content unchanged); repeated success path keeps exactly one link per line (no duplicates, none dangling after replace).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** full `integration-tests/http/invoices.spec.ts` green; tsc and lint clean.
- [ ] **Step 5: Commit** — `fix(backend): keep invoice link writes inside the update lock`.

---

### Task 6: Supplier balances

**Files:**
- Create: `src/api/admin/supplier-balances/route.ts`, `src/api/admin/supplier-balances/summarize-balances.ts`; query schema in `src/api/admin/supplier-balances/middlewares.ts`
- Modify: `src/api/middlewares.ts`
- Test: `src/api/admin/supplier-balances/__tests__/summarize-balances.unit.spec.ts`, `integration-tests/http/supplier-balances.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers, posted invoices and their payments, supplier names via `query.graph`.
- Produces `summarizeBalances(invoices: { supplier_id: string; status: string; total: number; due_date: string|Date|null; payments: {amount:number; status:string}[] }[], today: Date): { supplier_id: string; invoiced_total: number; paid_total: number; balance_owed: number; overdue_total: number; open_invoices: number }[]` — only posted invoices; draft and void ignored; voided payments ignored; `overdue_total` is the sum of balances of overdue invoices; `open_invoices` counts posted invoices with balance > 0 in cents; sorted by `balance_owed` descending then `supplier_id`.
- Produces `GET /admin/supplier-balances?q&limit&offset` -> `{ balances: [{ supplier: {id,name}, ...above }], count, offset, limit }`; only suppliers with at least one posted invoice; `q` filters by supplier name (escaped, case-insensitive); pagination in memory after aggregation; reads ALL posted invoices and payments with explicit `take: null`.

- [ ] **Step 1: Write the failing tests.** Unit: empty input; two suppliers; a draft and a void invoice ignored; a voided payment ignored; overdue total uses the fixed `today`; cent-exact balances (`0.1`+`0.2` payments against `0.30`); sort order and tiebreak. HTTP: hand-computed figures for two suppliers with mixed paid/unpaid/overdue invoices; a supplier with only a draft invoice is absent; `q` escaping and pagination count; 60 posted invoices counted fully; unauthenticated 401.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add supplier balances`.

---

### Task 7: Payments and Payables pages

**Files:**
- Create: `src/admin/routes/accounting/payments/page.tsx` (config label "Payments"), `src/admin/routes/accounting/payables/page.tsx` (config label "Payables"); extend `src/admin/routes/accounting/types.ts` (`AdminPayment`, `SupplierBalance`; invoice payment fields) and `format.ts` if needed
- Test: `src/admin/routes/accounting/payments/__tests__/page.unit.spec.tsx`, `src/admin/routes/accounting/payables/__tests__/page.unit.spec.tsx`

**Interfaces:** Consumes `GET /admin/supplier-payments` and `GET /admin/supplier-balances` (Tasks 2 and 6; shapes exactly as their mappers). Follow `src/admin/routes/accounting/invoices/page.tsx` and its tests (debounced search with Enter, status filter resetting offset, clamped pagination, error state with Retry, USD formatter).

- [ ] **Step 1: Write the failing tests.** Payments: rows (PAY reference, date, supplier, invoice reference and number linking to `/accounting/invoices/<invoice id>`, method label, amount in USD, status badge with void styling), filters for status and method send the query params and reset the offset, search by reference with debounce and Enter, pagination clamp, empty and error-with-Retry states, unknown method/status strings fall back to the raw text. Payables: rows (supplier name, invoiced, paid, owed, overdue — overdue highlighted only when > 0, open invoices), each supplier links to `/accounting/invoices?supplier_id=<id>` (the invoice list must read that param — add `supplier_id` support to the invoice list page's query state from the URL, with a test), sorted as the server returns, search by supplier name, pagination clamp, empty and error states. Both pages: route configs have the right labels and no `nested`.
- [ ] **Step 2: Run, expect FAIL** — `yarn test:unit src/admin/routes/accounting`. **Step 3: Implement.** **Step 4: Run, expect PASS;** tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add payments and payables pages`.

---

### Task 8: Invoice payment UI

**Files:**
- Modify: `src/admin/routes/accounting/invoices/page.tsx` (columns paid and balance, payment-status and overdue badges, payment-status filter), `src/admin/routes/accounting/invoices/[id]/page.tsx` and its components (payments section, totals show paid and balance, Record payment button)
- Create: `src/admin/routes/accounting/invoices/[id]/components/record-payment-dialog.tsx`, `payments-section.tsx`
- Test: the corresponding `__tests__` specs

**Interfaces:** Consumes the invoice payment fields and `payments` array (Task 3), `POST /admin/supplier-payments`, `POST /admin/supplier-payments/:id/void`. Types from Task 7's `types.ts`.

- [ ] **Step 1: Write the failing tests.** List: paid and balance columns in USD, payment-status badge (unpaid, part paid, paid; nothing for draft/void) and an Overdue badge, the payment-status filter sends `payment_status` and resets the offset, existing list behaviour unchanged. Detail: payments section (date, method label, payment reference, amount, status, Void with `usePrompt` confirmation; voided payments muted), totals show paid and balance, **Record payment** shown only for posted invoices with balance > 0 and disabled while Save/Post/Void on the invoice is pending (and those are disabled while a payment request is pending), the dialog: amount prefilled to the balance, date defaults to today, method select, reference and note, strict amount parsing (rejects '', 'abc', 0, negatives, more than 2 decimals, more than the balance — with an inline message), posts exactly `{ invoice_id, amount, paid_at, method, reference?, note? }` (blank optionals omitted), server 400 shown inline and the dialog stays open, success toast closes it and the invoice refetches (balance and status badge update), no effect resets the dialog fields on refetch; voiding a payment updates the balance; **Void invoice** shows the server's "void the payments first" message as a toast/inline error; unknown payment status or method strings do not render empty badges. Prove key tests against broken variants (record the RED): overpay allowed, Record payment shown on draft, optional blank fields sent as '', payment dialog resetting on refetch.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS;** `yarn test:unit src/admin`; tsc and lint clean.
- [ ] **Step 5: Commit** — `feat(backend): add payment UI to invoices`.

---

### Task 9: Whole-branch verification

- [ ] **Step 1:** `yarn build` (backend and admin build; lint 0 errors).
- [ ] **Step 2:** `yarn test:unit src/modules src/workflows src/api src/admin`, `yarn test:integration:modules`, `yarn test:integration:http` (all pass; the "Connection ended unexpectedly" teardown noise is known; if the memory monitor kills the full HTTP run, rerun the unfinished suites individually and say so).
- [ ] **Step 3:** Confirm by grep that `src/modules/accounting` has no non-test imports from the purchase or supplier modules, and that no payment or invoice workflow touches inventory.
- [ ] **Step 4:** Report that `npx medusa db:migrate` must be run on the dev database (new payment table and link). Do not run it unless the controller says so. Commit only if files changed.
