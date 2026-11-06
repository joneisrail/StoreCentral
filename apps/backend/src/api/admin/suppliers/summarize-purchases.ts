import { calculatePurchaseTotals } from "../../../modules/purchase/utils"

type SummaryPurchase = {
  status: string
  shipping_cost: number
  tax: number
  other_cost: number
  items: { quantity: number; quantity_received: number; unit_cost: number }[]
}

export type PurchaseSummary = {
  counts: Record<string, number>
  total_ordered: number
  total_received: number
  outstanding: number
}

const EXCLUDED_FROM_MONEY = ["draft", "cancelled"]

const round = (value: number): number => Math.round(value * 100) / 100

export const summarizePurchases = (
  purchases: SummaryPurchase[]
): PurchaseSummary => {
  const counts: Record<string, number> = {}
  let totalOrdered = 0
  let totalReceived = 0
  let outstanding = 0

  for (const purchase of purchases) {
    counts[purchase.status] = (counts[purchase.status] ?? 0) + 1

    if (EXCLUDED_FROM_MONEY.includes(purchase.status)) {
      continue
    }

    totalOrdered += calculatePurchaseTotals(purchase.items, purchase).total
    for (const item of purchase.items) {
      totalReceived += item.quantity_received * item.unit_cost
      outstanding += (item.quantity - item.quantity_received) * item.unit_cost
    }
  }

  return {
    counts,
    total_ordered: round(totalOrdered),
    total_received: round(totalReceived),
    outstanding: round(outstanding),
  }
}
