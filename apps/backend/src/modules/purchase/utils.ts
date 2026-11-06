import { MedusaError } from "@medusajs/framework/utils"

const round = (value: number): number => Math.round(value * 100) / 100

export const formatPurchaseReference = (displayId: number): string =>
  `PO-${String(displayId).padStart(4, "0")}`

export const calculatePurchaseTotals = (
  items: { quantity: number; unit_cost: number }[],
  extra: { shipping_cost: number; tax: number; other_cost: number }
): { subtotal: number; total: number } => {
  const subtotal = round(
    items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  )
  const total = round(
    subtotal + extra.shipping_cost + extra.tax + extra.other_cost
  )
  return { subtotal, total }
}

export const getRemainingQuantity = (item: {
  quantity: number
  quantity_received: number
}): number => item.quantity - item.quantity_received

export const validateReceiveQuantities = (
  items: { id: string; title: string; quantity: number; quantity_received: number }[],
  requested: { purchase_item_id: string; quantity: number }[]
): void => {
  if (!requested.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Provide at least one item to receive"
    )
  }

  const seen = new Set<string>()
  for (const line of requested) {
    if (seen.has(line.purchase_item_id)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Purchase item ${line.purchase_item_id} appears more than once`
      )
    }
    seen.add(line.purchase_item_id)
  }

  for (const line of requested) {
    const item = items.find((i) => i.id === line.purchase_item_id)
    if (!item) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Purchase item ${line.purchase_item_id} does not belong to this purchase`
      )
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Quantity for ${item.title} must be a whole number greater than 0`
      )
    }
    const remaining = getRemainingQuantity(item)
    if (line.quantity > remaining) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot receive ${line.quantity} of ${item.title}: only ${remaining} remaining`
      )
    }
  }
}

export const getStatusAfterReceipt = (
  items: { quantity: number; quantity_received: number }[]
): "partially_received" | "received" =>
  items.every((item) => getRemainingQuantity(item) <= 0)
    ? "received"
    : "partially_received"

// Lock key shared by every step that reads and then writes a purchase's
// status or received quantities (receive, cancel).
export const purchaseLockKey = (purchaseId: string): string =>
  "purchase:" + purchaseId
