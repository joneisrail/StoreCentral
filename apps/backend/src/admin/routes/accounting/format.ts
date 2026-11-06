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
