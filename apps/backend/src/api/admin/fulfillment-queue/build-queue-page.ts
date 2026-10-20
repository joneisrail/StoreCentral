import type { OrderDetailDTO } from "@medusajs/framework/types"

/**
 * OrderDetailDTO doesn't type the sales_channel relation directly (only
 * sales_channel_id) -- this is the real shape once the caller requests
 * "sales_channel.id"/"sales_channel.name" as expanded fields.
 */
export type OrderWithSalesChannel = OrderDetailDTO & {
  sales_channel?: { id: string; name: string } | null
}

export type FulfillmentQueueOrder = {
  id: string
  display_id: number
  created_at: string
  email: string | null
  total: number
  currency_code: string
  fulfillment_status: "not_fulfilled" | "partially_fulfilled"
  sales_channel: { id: string; name: string } | null
  item_count: number
}

export type FulfillmentQueuePage = {
  orders: FulfillmentQueueOrder[]
  count: number
}

const NEEDS_FULFILLMENT_STATUSES = new Set([
  "not_fulfilled",
  "partially_fulfilled",
])

/**
 * Keeps only the orders that still need fulfilling, sorts oldest
 * first, and paginates the filtered set.
 *
 * `order.fulfillment_status` is read directly rather than recomputed:
 * getOrdersListWorkflow already computes it (via core's own
 * getLastFulfillmentStatus) on every order, unconditionally, before
 * this function ever sees them. Recomputing it here was tried and
 * found actively wrong -- the workflow also strips the raw
 * `fulfillments` relation afterward whenever the caller's requested
 * fields don't mention it, so a second call to getLastFulfillmentStatus
 * in this function was operating on already-stripped data and silently
 * computed "not_fulfilled" for every order, confirmed by comparing
 * against GET /admin/orders/:id's own (correct) fulfillment_status for
 * the same order.
 */
export function buildQueuePage(
  orders: OrderWithSalesChannel[],
  pagination: { offset: number; limit: number }
): FulfillmentQueuePage {
  const needsFulfillment = orders
    .map((order) => ({ order, status: order.fulfillment_status as string }))
    .filter(({ status }) => NEEDS_FULFILLMENT_STATUSES.has(status))
    .sort(
      (a, b) =>
        new Date(a.order.created_at).getTime() -
        new Date(b.order.created_at).getTime()
    )

  const { offset, limit } = pagination
  const page = needsFulfillment.slice(offset, offset + limit)

  return {
    orders: page.map(({ order, status }) => ({
      id: order.id,
      display_id: order.display_id,
      created_at: order.created_at as unknown as string,
      email: order.email ?? null,
      total: order.total as unknown as number,
      currency_code: order.currency_code,
      fulfillment_status: status as "not_fulfilled" | "partially_fulfilled",
      sales_channel: order.sales_channel
        ? { id: order.sales_channel.id, name: order.sales_channel.name }
        : null,
      item_count: order.items?.length ?? 0,
    })),
    count: needsFulfillment.length,
  }
}
