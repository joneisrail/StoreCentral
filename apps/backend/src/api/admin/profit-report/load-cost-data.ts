import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { CostPurchase } from "../../../modules/accounting/profit"

const PAGE_SIZE = 200

const PURCHASE_FIELDS = [
  "id",
  "shipping_cost",
  "tax",
  "other_cost",
  "items.id",
  "items.variant_id",
  "items.quantity",
  "items.unit_cost",
  "receipts.id",
  "receipts.received_at",
  "receipts.items.purchase_item_id",
  "receipts.items.quantity",
]

// Purchases with at least one receipt received before endExclusive, read in
// pages of 200. Receipts at or after endExclusive are dropped so they can
// never cost a sale in the range.
export async function loadCostData(
  scope: MedusaContainer,
  endExclusive: Date
): Promise<CostPurchase[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const endMs = endExclusive.getTime()
  const kept: CostPurchase[] = []

  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data } = await query.graph({
      entity: "purchase",
      fields: PURCHASE_FIELDS,
      pagination: { skip, take: PAGE_SIZE, order: { id: "ASC" } },
      // query.graph's filter typing does not cover module entities by name.
    } as any)
    const page = data as unknown as CostPurchase[]

    for (const purchase of page) {
      const receipts = (purchase.receipts ?? []).filter(
        (receipt) => new Date(receipt.received_at).getTime() < endMs
      )
      if (receipts.length > 0) {
        kept.push({ ...purchase, receipts })
      }
    }

    if (page.length < PAGE_SIZE) {
      return kept
    }
  }
}
