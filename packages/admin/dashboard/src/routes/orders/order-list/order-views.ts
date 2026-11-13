export type OrderListView =
  | "all"
  | "ready-to-ship"
  | "shipped"
  | "awaiting-payment"
  | "on-hold"
  | "cancelled"

export const ORDER_VIEW_ORDER: OrderListView[] = [
  "all",
  "ready-to-ship",
  "shipped",
  "awaiting-payment",
  "on-hold",
  "cancelled",
]

/** The Shipped view's filter, shared with the Shipped table. */
export const SHIPPED_QUERY = {
  fulfillment_status: [
    "shipped",
    "partially_shipped",
    "partially_delivered",
    "delivered",
  ],
}

export type OrderViewQueryContext = {
  heldIds: string[]
  holdTagId: string | null
}

export const getViewQuery = (
  view: OrderListView,
  { heldIds, holdTagId }: OrderViewQueryContext
): Record<string, unknown> => {
  const excludeHeld = heldIds.length ? { id: { $nin: heldIds } } : {}

  switch (view) {
    case "ready-to-ship":
      return {
        fulfillment_status: ["not_fulfilled", "partially_fulfilled"],
        payment_status: ["captured", "partially_captured"],
        status: { $nin: ["canceled"] },
        ...excludeHeld,
      }
    case "shipped":
      return { ...SHIPPED_QUERY }
    case "awaiting-payment":
      return {
        payment_status: ["not_paid", "awaiting"],
        status: { $nin: ["canceled"] },
        ...excludeHeld,
      }
    case "on-hold":
      // With no hold tag nothing can be held: an impossible id matches no rows.
      return holdTagId
        ? { tag_id: holdTagId, status: { $nin: ["canceled"] } }
        : { id: "__no_hold_tag__" }
    case "cancelled":
      return { status: "canceled" }
    default:
      return {}
  }
}
