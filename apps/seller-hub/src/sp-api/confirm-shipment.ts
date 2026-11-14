import type { SpApiClient } from "./client.js"

// UNVERIFIED against Amazon. The path (`POST
// /orders/v0/orders/{orderId}/shipmentConfirmation`) and the body field names
// (`marketplaceId`, `packageDetail.{packageReferenceId, carrierCode,
// trackingNumber, shipDate, orderItems[].{orderItemId, quantity}}`) are written
// from the SP-API Orders v0 `confirmShipment` documentation as understood and
// have never been exercised against a real or sandbox seller account.
// Re-check them, the carrier code list and the rate limit before enabling.
//
// GATED OFF: nothing calls this. Amazon tracking jobs are not enqueued
// (there is no Amazon runtime), so it is exported for the day Amazon is live.
const CONFIRM_SHIPMENT_RATE_LIMIT = { ratePerSecond: 2, burst: 10 }

export type ConfirmShipmentInput = {
  amazonOrderId: string
  marketplaceId: string
  carrierCode: string
  trackingNumber: string
  /** ISO 8601 date-time. */
  shipDate: string
  items: { orderItemId: string; quantity: number }[]
}

/**
 * Confirms a shipment (carrier + tracking number) on an Amazon order.
 * Errors from the client propagate unchanged; this function logs nothing.
 */
export const confirmShipment = async (
  client: SpApiClient,
  input: ConfirmShipmentInput
): Promise<void> => {
  await client.request<unknown>({
    name: "confirmShipment",
    method: "POST",
    path: `/orders/v0/orders/${encodeURIComponent(input.amazonOrderId)}/shipmentConfirmation`,
    body: {
      marketplaceId: input.marketplaceId,
      packageDetail: {
        packageReferenceId: "1",
        carrierCode: input.carrierCode,
        trackingNumber: input.trackingNumber,
        shipDate: input.shipDate,
        orderItems: input.items.map((i) => ({
          orderItemId: i.orderItemId,
          quantity: i.quantity,
        })),
      },
    },
    rateLimit: CONFIRM_SHIPMENT_RATE_LIMIT,
  })
}
