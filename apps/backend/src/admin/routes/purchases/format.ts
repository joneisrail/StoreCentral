const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// Amounts are plain dollar values (12.5 is $12.50), never cents.
export function formatUsd(amount: number) {
  return usd.format(amount)
}

export const STATUS_LABELS = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
} as const

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}
