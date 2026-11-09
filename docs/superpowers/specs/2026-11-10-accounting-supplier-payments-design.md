# Accounting: Supplier Payments — Design

Second piece of the accounting module. Builds on
`2026-11-06-accounting-supplier-invoices-design.md` (invoices, the
`accounting` module, the status lock) and the purchase and supplier specs.
Same layering (module -> workflow -> admin route -> admin page).

## Purpose

Record the money paid to suppliers against their posted invoices, so each
invoice shows what has been paid and what is still owed, and the admin can see
what is owed to each supplier.

**Intended outcome:** the admin opens a posted invoice, records a payment
(amount, date, method, reference), and sees the balance drop. A Payables page
shows, per supplier, how much has been invoiced, paid and is still owed, and
how much of that is overdue. Mistakes are corrected by voiding a payment and
entering it again.

**Explicitly out of scope:**
- Supplier refunds, credit notes and debit notes.
- One payment split across several invoices (a payment pays exactly one
  invoice; an invoice may have several part payments).
- Bank feeds, reconciliation, attachments and supplier statements.
- Sales, revenue and profit (later pieces).
- Any change to stock.
- Currencies other than USD.

## Decisions carried from brainstorming

- Accounting is built in pieces: 1 supplier invoices (done), 2 supplier
  payments (this), 3 sales and revenue, 4 profit. (Agreed.)
- A payment pays one invoice; an invoice can have several payments.
  (Chosen: recommended option.)
- Payments are not edited; a mistaken payment is voided and re-entered.
  (Recommended, taken.)
- Overpaying is refused. Voiding an invoice that has live payments is refused.
  Cancelling a purchase that has a draft or posted invoice is refused.
  (Recommended, taken; the last closes a gap found in the piece 1 review.)

## Architecture

```
apps/backend/src/
  modules/accounting/       + models/payment.ts, service (Payment), utils.ts additions
  links/                    payment-invoice.ts
  workflows/                record-payment, void-payment (+ steps/)
                            (changed) void-invoice, post-invoice,
                            update-invoice, cancel-purchase steps
  api/admin/supplier-payments/       route.ts, [id]/route.ts, [id]/void/route.ts,
                            middlewares.ts, map-payment.ts
  api/admin/supplier-balances/   route.ts
  api/admin/invoices/       map-invoice.ts gains payment fields
  admin/routes/accounting/  payments/ (list), payables/ (balances),
                            invoices/ pages gain payment UI
```

The accounting module still imports nothing from the purchase or supplier
services. Migrations are generated with `npx medusa db:generate accounting`,
never hand-written.

### Data model

**Payment** (new, in the `accounting` module):

| Field | Notes |
|---|---|
| `id` | |
| `display_id` | autoincrement; shown as `PAY-0001` |
| `invoice_id` | the invoice paid (plain column, also linked) |
| `supplier_id` | snapshot from the invoice, for filtering and the payables view |
| `amount` | `bigNumber`, plain dollars, greater than 0, at most 2 decimals |
| `paid_at` | date the money was paid (`YYYY-MM-DD`) |
| `method` | `bank_transfer`, `cash`, `card`, `cheque`, `other` |
| `reference` | optional text (cheque or transfer number), trimmed |
| `note` | optional text |
| `status` | `recorded` or `void` |
| `voided_at` | set when voided |
| `currency_code` | fixed `usd` |

Link: Payment to Invoice (many payments per invoice).

Computed on read, never stored:
- `paid_total` = sum of `amount` over non-void payments of the invoice.
- `balance` = invoice `total` minus `paid_total`, rounded to 2 decimals.
- `payment_status`: `unpaid` (paid_total 0), `paid` (balance 0), otherwise
  `partially_paid`. Only meaningful for posted invoices; draft and void
  invoices return `null`.
- `overdue`: the invoice is posted, has a `due_date` earlier than today (UTC
  date), and `balance` is greater than 0.

## Rules

- **Record payment:** the invoice must be `posted`. `amount` must be greater
  than 0 and not exceed the current balance (compared at 2 decimals). The
  check and the insert run inside `locking.execute([invoiceStatusLockKey
  (invoice_id)])`, so two simultaneous payments cannot together exceed the
  balance and a payment cannot land while the invoice is being voided.
  The payment is linked to its invoice.
- **Void payment:** allowed once, from `recorded`. Runs under the same invoice
  status lock. A voided payment stops counting immediately.
- **Void invoice (changed):** inside the existing lock, refuse with a clear
  message when the invoice has any `recorded` payment ("void the payments
  first"). Void invoices with only void payments are allowed.
- **Cancel purchase (changed):** inside the existing purchase lock, refuse
  when the purchase has any invoice that is not `void` (name the invoice
  reference in the message). `post-invoice` additionally takes the purchase
  lock (`purchaseLockKey`) after the invoice status lock, in that order, and
  re-checks the purchase status inside it, so a posted invoice can never end
  up on a purchase that was cancelled a moment earlier.
- **Update invoice hardening (changed):** the invoice-item link dismiss and
  create steps move inside the locked write of the update step (using the
  link service and the step's existing undo), so the draft check covers the
  whole mutation and a failed link write can never overwrite an invoice that
  was posted meanwhile.
- Payments never change stock or purchases.

Lock order everywhere: invoice status lock, then invoice-number lock, then
purchase lock. Recording, voiding and invoice voiding take only the invoice
status lock; post takes status then purchase; cancel takes only the purchase
lock and reads invoices.

## API contract

All routes are admin-only (auth is automatic under `/admin/*`). Zod from
`@medusajs/framework/zod`; schema types are exported. GET and POST only.

| Method and path | Purpose |
|---|---|
| `GET /admin/supplier-payments` | List: filters `invoice_id`, `supplier_id`, `status`, `method`; `q` searches reference (case-insensitive, `%` and `_` literal); paginated, newest first with an `id` tiebreak |
| `POST /admin/supplier-payments` | Record: `invoice_id`, `amount`, `paid_at`, `method`, optional `reference`, `note` |
| `GET /admin/supplier-payments/:id` | One payment with invoice reference and supplier |
| `POST /admin/supplier-payments/:id/void` | Void |
| `GET /admin/supplier-balances` | One row per supplier that has posted invoices: `supplier`, `invoiced_total`, `paid_total`, `balance_owed`, `overdue_total`, `open_invoices` (posted with balance > 0); supports `q` on supplier name, pagination, sorted by `balance_owed` descending |

Note: the path is `supplier-payments` to avoid the core Medusa `/admin/payments` routes and their middlewares.

Invoice responses (`GET /admin/invoices`, `GET /admin/invoices/:id` and the
payment routes' embedded invoices) gain `paid_total`, `balance`,
`payment_status` and `overdue`; the invoice list gains a `payment_status`
filter (`unpaid`, `partially_paid`, `paid`, `overdue`). `GET /admin/invoices/:id`
also returns the invoice's payments (newest first).

Errors use `MedusaError` with clear messages: paying a draft or void invoice;
amount over balance names the balance; voiding an invoice names the payments
that block it; cancelling a purchase names the blocking invoices.

## UI

- **Accounting menu** gains **Payments** and **Payables** sub-items beside
  Invoices (same path-nesting as Invoices).
- **Payments list:** reference, date paid, supplier, invoice reference and
  number, method, amount, status; filters for status and method, search by
  reference; pagination (clamped); error state with Retry.
- **Payables:** one row per supplier with invoiced, paid, owed and overdue;
  each row links to that supplier's invoices (the invoice list filtered by
  supplier).
- **Invoice list:** gains paid, balance, a payment-status badge, an Overdue
  badge, and a payment-status filter.
- **Invoice detail:** a payments section (date, method, reference, amount,
  status, Void with confirmation), totals showing paid and balance, and a
  **Record payment** button (posted invoices with a balance) opening a dialog
  with amount prefilled to the balance, date defaulting to today, method,
  reference and note; strict numeric parsing; server errors shown inline.
- All requests use `sdk.client.fetch`; mutations show toasts and invalidate the
  shared query prefixes (`["admin","invoices"]`, `["admin","supplier-payments"]`,
  `["admin","supplier-balances"]`, `["admin","purchase-invoices"]`). Buttons
  are disabled while a request is in flight; Record payment is disabled while
  a Save, Post or Void on the same invoice is pending.

## Testing

- **Unit:** payment totals and balance rounding (parity with invoice
  totals), payment status and overdue calculation (today boundary), payables
  aggregation, reference formatting.
- **Module integration:** the Payment model, defaults, status, links.
- **HTTP integration:** each route; paying a draft or void invoice refused;
  overpay refused and exact-balance accepted; two concurrent payments that
  together exceed the balance (exactly one succeeds); payment racing an
  invoice void (never both succeed); voiding a payment frees the balance;
  void-twice refused; void invoice refused with a live payment and allowed
  after the payment is voided; cancel purchase refused with a draft or posted
  invoice and allowed with only void invoices; post racing a purchase cancel
  (never a posted invoice on a cancelled purchase); update-invoice link
  failure never rewrites a posted invoice (failure injection); payables
  numbers; list filters, `q` escaping, pagination; stock unchanged.
- **Admin pages:** component tests in the existing style for the payments
  list, payables, the invoice payment section and the Record payment dialog.
- **Before finishing:** build, lint, every test added, and the migration
  applied to the dev database.

## Open assumptions to confirm

- Menu names are **Payments** and **Payables**.
- "Overdue" compares the due date with today's UTC date.
- A payment amount has at most 2 decimal places.

## Review Focus

- Two simultaneous payments that together exceed the balance: exactly one
  wins.
- A payment racing an invoice void: never a voided invoice with a live
  payment.
- A purchase cancel racing an invoice post.
- Rounding: a balance of 0.1 + 0.2 style sums must not strand a cent or
  allow overpaying by a cent.
- A voided payment must not count anywhere (balance, payables, status).
