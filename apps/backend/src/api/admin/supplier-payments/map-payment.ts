import {
  formatInvoiceReference,
  formatPaymentReference,
} from "../../../modules/accounting/utils"

type DateValue = string | Date

export type PaymentRow = {
  id: string
  display_id: number
  invoice_id: string
  supplier_id: string
  amount: number | string
  paid_at: DateValue
  method: string
  reference: string | null
  note: string | null
  status: string
  voided_at: DateValue | null
  created_at: DateValue
}

export type PaymentExtras = {
  supplier: { id: string; name: string } | null
  invoice: { id: string; display_id: number; invoice_number: string } | null
}

export type AdminPayment = {
  id: string
  reference: string
  invoice: { id: string; reference: string; invoice_number: string } | null
  supplier: { id: string; name: string } | null
  amount: number
  paid_at: string
  method: string
  payment_reference: string | null
  note: string | null
  status: string
  voided_at: DateValue | null
  created_at: DateValue
}

// The payment date is a calendar date.
const toDateOnly = (value: DateValue): string =>
  new Date(value).toISOString().slice(0, 10)

export const mapPayment = (
  row: PaymentRow,
  extras: PaymentExtras
): AdminPayment => ({
  id: row.id,
  reference: formatPaymentReference(row.display_id),
  invoice: extras.invoice
    ? {
        id: extras.invoice.id,
        reference: formatInvoiceReference(extras.invoice.display_id),
        invoice_number: extras.invoice.invoice_number,
      }
    : null,
  supplier: extras.supplier,
  amount: Number(row.amount),
  paid_at: toDateOnly(row.paid_at),
  method: row.method,
  payment_reference: row.reference,
  note: row.note,
  status: row.status,
  voided_at: row.voided_at,
  created_at: row.created_at,
})
