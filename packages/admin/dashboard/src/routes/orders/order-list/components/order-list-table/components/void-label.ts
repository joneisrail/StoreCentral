export type RowActionsFulfillment = {
  id: string
  data?: Record<string, unknown> | null
  shipped_at?: string | Date | null
  delivered_at?: string | Date | null
  canceled_at?: string | Date | null
}

/**
 * A label can be voided while some live (non-canceled) fulfillment carries
 * a bought EasyPost label and has neither shipped nor been delivered.
 */
export const hasVoidableLabel = (
  fulfillments?: RowActionsFulfillment[] | null
): boolean =>
  (fulfillments ?? []).some(
    (f) =>
      !f.canceled_at &&
      !f.shipped_at &&
      !f.delivered_at &&
      !!f.data?.easypost_shipment_id
  )
