import { isOverdue, toCents } from "../../../modules/accounting/utils"

type BalanceInvoice = {
  supplier_id: string
  status: string
  total: number
  due_date: string | Date | null
  payments: { amount: number; status: string }[]
}

export type SupplierBalance = {
  supplier_id: string
  invoiced_total: number
  paid_total: number
  balance_owed: number
  overdue_total: number
  open_invoices: number
}

type Cents = {
  invoiced: number
  paid: number
  overdue: number
  open: number
}

// Pure aggregation: only posted invoices count, voided payments are ignored,
// and every sum is kept in integer cents.
export const summarizeBalances = (
  invoices: BalanceInvoice[],
  today: Date
): SupplierBalance[] => {
  const bySupplier = new Map<string, Cents>()

  for (const invoice of invoices) {
    if (invoice.status !== "posted") {
      continue
    }
    const totalCents = toCents(invoice.total)
    const paidCents = invoice.payments
      .filter((p) => p.status !== "void")
      .reduce((sum, p) => sum + toCents(p.amount), 0)
    const balanceCents = totalCents - paidCents

    const acc = bySupplier.get(invoice.supplier_id) ?? {
      invoiced: 0,
      paid: 0,
      overdue: 0,
      open: 0,
    }
    acc.invoiced += totalCents
    acc.paid += paidCents
    if (balanceCents > 0) {
      acc.open += 1
    }
    if (
      isOverdue(
        {
          invoice_status: invoice.status,
          due_date: invoice.due_date,
          balance: balanceCents / 100,
        },
        today
      )
    ) {
      acc.overdue += balanceCents
    }
    bySupplier.set(invoice.supplier_id, acc)
  }

  return [...bySupplier.entries()]
    .map(([supplier_id, c]) => ({
      supplier_id,
      invoiced_total: c.invoiced / 100,
      paid_total: c.paid / 100,
      balance_owed: (c.invoiced - c.paid) / 100,
      overdue_total: c.overdue / 100,
      open_invoices: c.open,
      _owed: c.invoiced - c.paid,
    }))
    .sort(
      (a, b) =>
        b._owed - a._owed ||
        (a.supplier_id < b.supplier_id ? -1 : a.supplier_id > b.supplier_id ? 1 : 0)
    )
    .map(({ _owed, ...row }) => row)
}
