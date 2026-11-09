import type { InvoiceStatus } from "./types"

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  void: "Void",
}

export const INVOICE_STATUS_COLORS: Record<
  InvoiceStatus,
  "grey" | "green" | "red"
> = {
  draft: "grey",
  posted: "green",
  void: "red",
}

// Invoice dates are calendar dates, so format them in UTC to avoid a day shift.
export function formatInvoiceDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" })
    : "—"
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  recorded: "Recorded",
  void: "Void",
}

export const PAYMENT_STATUS_COLORS: Record<string, "green" | "red" | "grey"> = {
  recorded: "green",
  void: "red",
}

// Unknown values fall back to the raw string so a badge is never empty.
export function paymentMethodLabel(method: string) {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

export function paymentStatusLabel(status: string) {
  return PAYMENT_STATUS_LABELS[status] ?? status
}

export function paymentStatusColor(status: string) {
  return PAYMENT_STATUS_COLORS[status] ?? "grey"
}

export const INVOICE_PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Part paid",
  paid: "Paid",
}

export const INVOICE_PAYMENT_STATUS_COLORS: Record<
  string,
  "red" | "orange" | "green" | "grey"
> = {
  unpaid: "red",
  partially_paid: "orange",
  paid: "green",
}

// Unknown strings fall back to the raw text so a badge is never empty.
export function invoicePaymentStatusLabel(status: string) {
  return INVOICE_PAYMENT_STATUS_LABELS[status] ?? status
}

export function invoicePaymentStatusColor(status: string) {
  return INVOICE_PAYMENT_STATUS_COLORS[status] ?? "grey"
}

// Money fields may be missing on an older cached response; show a dash, not NaN.
export function formatMoneyOrDash(
  value: unknown,
  format: (amount: number) => string
) {
  return typeof value === "number" && Number.isFinite(value)
    ? format(value)
    : "—"
}
