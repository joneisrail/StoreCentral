import {
  calculateBalance,
  calculateInvoiceTotals,
  calculatePaidTotal,
  formatInvoiceReference,
  getPaymentStatus,
  isOverdue,
} from "../../../modules/accounting/utils"
import { formatPurchaseReference } from "../../../modules/purchase/utils"

export const INVOICE_FIELDS = [
  "id",
  "display_id",
  "status",
  "supplier_id",
  "purchase_id",
  "invoice_number",
  "invoice_date",
  "due_date",
  "currency_code",
  "shipping_cost",
  "tax",
  "other_cost",
  "notes",
  "posted_at",
  "voided_at",
  "created_at",
  "items.*",
  "purchase.id",
  "purchase.display_id",
]

type Money = number | string
type DateValue = string | Date

export type InvoiceRow = {
  id: string
  display_id: number
  status: string
  supplier_id: string
  purchase_id: string
  invoice_number: string
  invoice_date: DateValue
  due_date: DateValue | null
  shipping_cost: Money
  tax: Money
  other_cost: Money
  notes: string | null
  posted_at: DateValue | null
  voided_at: DateValue | null
  created_at: DateValue
  items: {
    id: string
    purchase_item_id: string | null
    variant_id: string
    supplier_sku: string
    description: string
    quantity: number
    unit_cost: Money
    created_at?: DateValue
  }[]
}

export type InvoiceExtras = {
  supplier: { id: string; name: string } | null
  purchase: { id: string; display_id: number } | null
}

export type InvoicePayment = { amount: Money; status: string }

export type AdminInvoiceItem = {
  id: string
  purchase_item_id: string | null
  variant_id: string
  supplier_sku: string
  description: string
  quantity: number
  unit_cost: number
  line_total: number
}

export type AdminInvoice = {
  id: string
  reference: string
  status: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  supplier: { id: string; name: string } | null
  purchase: { id: string; reference: string } | null
  items: AdminInvoiceItem[]
  shipping_cost: number
  tax: number
  other_cost: number
  subtotal: number
  total: number
  paid_total: number
  balance: number
  payment_status: "unpaid" | "partially_paid" | "paid" | null
  overdue: boolean
  notes: string | null
  posted_at: DateValue | null
  voided_at: DateValue | null
  created_at: DateValue
}

const round = (value: number): number => Math.round(value * 100) / 100

// Invoice and due dates are calendar dates (stored at UTC midnight).
const toDateOnly = (value: DateValue): string =>
  new Date(value).toISOString().slice(0, 10)

export const mapInvoice = (
  row: InvoiceRow,
  extras: InvoiceExtras,
  payments: InvoicePayment[] = [],
  // Injectable clock; callers pass the request's "now" (UTC calendar date).
  today: Date = new Date()
): AdminInvoice => {
  const items = [...(row.items ?? [])]
    .sort((a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
      a.id.localeCompare(b.id)
    )
    .map((item) => {
      const unit_cost = Number(item.unit_cost)
      return {
        id: item.id,
        purchase_item_id: item.purchase_item_id ?? null,
        variant_id: item.variant_id,
        supplier_sku: item.supplier_sku,
        description: item.description,
        quantity: item.quantity,
        unit_cost,
        line_total: round(item.quantity * unit_cost),
      }
    })

  const shipping_cost = Number(row.shipping_cost)
  const tax = Number(row.tax)
  const other_cost = Number(row.other_cost)
  const { subtotal, total } = calculateInvoiceTotals(items, {
    shipping_cost,
    tax,
    other_cost,
  })

  const numeric = payments.map((p) => ({
    amount: Number(p.amount),
    status: p.status,
  }))
  const paid_total = calculatePaidTotal(numeric)
  const balance = calculateBalance(total, numeric)
  const due_date = row.due_date ? toDateOnly(row.due_date) : null

  return {
    id: row.id,
    reference: formatInvoiceReference(row.display_id),
    status: row.status,
    invoice_number: row.invoice_number,
    invoice_date: toDateOnly(row.invoice_date),
    due_date,
    supplier: extras.supplier,
    purchase: extras.purchase
      ? {
          id: extras.purchase.id,
          reference: formatPurchaseReference(extras.purchase.display_id),
        }
      : null,
    items,
    shipping_cost,
    tax,
    other_cost,
    subtotal,
    total,
    paid_total,
    balance,
    payment_status: getPaymentStatus({
      invoice_status: row.status,
      total,
      paid_total,
    }),
    overdue: isOverdue(
      { invoice_status: row.status, due_date, balance },
      today
    ),
    notes: row.notes,
    posted_at: row.posted_at,
    voided_at: row.voided_at,
    created_at: row.created_at,
  }
}
