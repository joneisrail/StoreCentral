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
  fulfillment_status: string
  sales_channel: { id: string; name: string } | null
  item_count: number
}

export type FulfillmentQueuePage = {
  orders: FulfillmentQueueOrder[]
  count: number
}

/**
 * True when at least one item on the order still has a real
 * unfulfilled unit (quantity > fulfilled_quantity).
 *
 * This -- not `order.fulfillment_status` -- is what "needs
 * fulfillment" actually means. A first implementation filtered on an
 * allow-list of the two fulfillment_status strings
 * ("not_fulfilled"/"partially_fulfilled"), found Critical by the final
 * whole-branch review: core's own status is the *highest stage any
 * fulfillment reached*, not "are there unfulfilled items" -- an order
 * that is 1-of-2 units shipped is "partially_shipped", which isn't in
 * that allow-list, so it silently vanished from the queue while a real
 * unit still needed fulfilling. Checking item quantities directly
 * (data getOrdersListWorkflow already fetches via its own hardcoded
 * "items.*") answers the actual question regardless of which of core's
 * 8 status strings the order happens to be in.
 */
function hasUnfulfilledItems(order: OrderWithSalesChannel): boolean {
  return (order.items ?? []).some(
    (item) => item.quantity > (item.detail?.fulfilled_quantity ?? 0)
  )
}

/**
 * Keeps only the orders that still need fulfilling, sorts oldest
 * first, and paginates the filtered set.
 *
 * `order.fulfillment_status` is carried through for display only (it
 * is read directly, not recomputed -- getOrdersListWorkflow already
 * computes it via core's own getLastFulfillmentStatus, and recomputing
 * it here was tried and found actively wrong: the workflow also strips
 * the raw `fulfillments` relation afterward whenever the caller's
 * requested fields don't mention it, so a second call to
 * getLastFulfillmentStatus operated on already-stripped data and
 * silently computed "not_fulfilled" for every order). It plays no part
 * in deciding which orders belong in the queue -- see
 * hasUnfulfilledItems's own comment for why.
 *
 * Orders whose order.status is itself canceled/archived/draft are
 * excluded at the database level (route.ts's `variables.filters`), not
 * here -- `getLastFulfillmentStatus` never looks at order.status at
 * all, so a canceled order with zero fulfillments reports
 * "not_fulfilled" and would otherwise pass this function's own check.
 */
export function buildQueuePage(
  orders: OrderWithSalesChannel[],
  pagination: { offset: number; limit: number }
): FulfillmentQueuePage {
  const needsFulfillment = orders
    .filter(hasUnfulfilledItems)
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

  const { offset, limit } = pagination
  const page = needsFulfillment.slice(offset, offset + limit)

  return {
    orders: page.map((order) => ({
      id: order.id,
      display_id: order.display_id,
      created_at: order.created_at as unknown as string,
      email: order.email ?? null,
      total: order.total as unknown as number,
      currency_code: order.currency_code,
      fulfillment_status: order.fulfillment_status,
      sales_channel: order.sales_channel
        ? { id: order.sales_channel.id, name: order.sales_channel.name }
        : null,
      item_count: order.items?.length ?? 0,
    })),
    count: needsFulfillment.length,
  }
}
