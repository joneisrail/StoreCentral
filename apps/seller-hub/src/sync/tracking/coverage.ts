/**
 * True when the fulfillment ships at least the ordered quantity of EVERY order
 * line (a whole-order shipment). An order with no lines is never "whole".
 */
export const coversWholeOrder = (
  orderItems: { id: string; quantity: number }[],
  fulfillmentItems: { lineItemId: string; quantity: number }[]
): boolean => {
  const shipped = new Map<string, number>()
  for (const fi of fulfillmentItems) {
    shipped.set(fi.lineItemId, (shipped.get(fi.lineItemId) ?? 0) + fi.quantity)
  }
  return (
    orderItems.length > 0 &&
    orderItems.every((i) => (shipped.get(i.id) ?? 0) >= i.quantity)
  )
}
