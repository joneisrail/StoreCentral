export type TrackingJobData = {
  fulfillmentId: string
  orderId: string
  noNotification: boolean
}

export type TrackingOrder = {
  id: string
  metadata: Record<string, unknown>
  items: { id: string; sku: string | null; quantity: number }[]
  fulfillments: {
    id: string
    canceledAt: string | null
    items: { lineItemId: string; quantity: number }[]
    labels: { trackingNumber: string; trackingUrl: string | null }[]
    /** fulfillment.data.carrier ?? metadata.carrier ?? data.easypost_carrier */
    carrier: string | null
  }[]
}

export type TrackingPush = (ctx: {
  order: TrackingOrder
  fulfillment: TrackingOrder["fulfillments"][number]
  externalOrderId: string
  noNotification: boolean
}) => Promise<"pushed" | "skipped">
