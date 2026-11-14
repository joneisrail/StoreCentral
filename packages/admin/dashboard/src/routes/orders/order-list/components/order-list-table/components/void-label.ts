export type RowActionsFulfillment = {
  id: string
  data?: Record<string, unknown> | null
  shipped_at?: string | Date | null
  delivered_at?: string | Date | null
  canceled_at?: string | Date | null
}

/**
 * Mirrors the backend's whole-order void rule: nothing may be voided once any
 * live (non-canceled) fulfillment has shipped or been delivered; otherwise a
 * void is possible when a live fulfillment carries a bought EasyPost label.
 */
export const hasVoidableLabel = (
  fulfillments?: RowActionsFulfillment[] | null
): boolean => {
  const live = (fulfillments ?? []).filter((f) => !f.canceled_at)

  if (live.some((f) => f.shipped_at || f.delivered_at)) {
    return false
  }

  return live.some((f) => !!f.data?.easypost_shipment_id)
}
