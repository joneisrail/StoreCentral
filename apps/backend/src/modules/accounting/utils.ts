import { MedusaError } from "@medusajs/framework/utils"

const round = (value: number): number => Math.round(value * 100) / 100

export const formatInvoiceReference = (displayId: number): string =>
  `INV-${String(displayId).padStart(4, "0")}`

export const normalizeInvoiceNumber = (
  raw: string
): { invoice_number: string; invoice_number_key: string } => {
  const invoice_number = (raw ?? "").trim()
  if (!invoice_number) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invoice number is required"
    )
  }
  return { invoice_number, invoice_number_key: invoice_number.toLowerCase() }
}

export const calculateInvoiceTotals = (
  items: { quantity: number; unit_cost: number }[],
  extra: { shipping_cost: number; tax: number; other_cost: number }
): { subtotal: number; total: number } => {
  const subtotal = round(
    items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  )
  const total = round(
    subtotal + extra.shipping_cost + extra.tax + extra.other_cost
  )
  return { subtotal, total }
}

// Serializes creation of invoices that share a supplier invoice number.
export const invoiceLockKey = (
  supplierId: string,
  invoiceNumberKey: string
): string => "invoice-number:" + supplierId + ":" + invoiceNumberKey

// Shared by every step that reads then writes an invoice's status.
export const invoiceStatusLockKey = (invoiceId: string): string =>
  "invoice:" + invoiceId

export const formatPaymentReference = (displayId: number): string =>
  `PAY-${String(displayId).padStart(4, "0")}`

export const toCents = (value: number): number => Math.round(value * 100)

export const isValidPaymentAmount = (amount: number): boolean =>
  typeof amount === "number" &&
  Number.isFinite(amount) &&
  amount > 0 &&
  Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9

export const calculatePaidTotal = (
  payments: { amount: number; status: string }[]
): number =>
  payments
    .filter((p) => p.status !== "void")
    .reduce((sum, p) => sum + toCents(p.amount), 0) / 100

export const calculateBalance = (
  total: number,
  payments: { amount: number; status: string }[]
): number => (toCents(total) - toCents(calculatePaidTotal(payments))) / 100

export const getPaymentStatus = (input: {
  invoice_status: string
  total: number
  paid_total: number
}): "unpaid" | "partially_paid" | "paid" | null => {
  if (input.invoice_status !== "posted") {
    return null
  }
  const paid = toCents(input.paid_total)
  if (paid <= 0) {
    return "unpaid"
  }
  return paid >= toCents(input.total) ? "paid" : "partially_paid"
}

const utcDay = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

export const isOverdue = (
  input: {
    invoice_status: string
    due_date: string | Date | null
    balance: number
  },
  today: Date
): boolean => {
  if (input.invoice_status !== "posted" || !input.due_date) {
    return false
  }
  if (toCents(input.balance) <= 0) {
    return false
  }
  return utcDay(new Date(input.due_date)) < utcDay(today)
}
