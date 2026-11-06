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
