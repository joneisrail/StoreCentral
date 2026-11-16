import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

export type VariantStock = {
  /** false when the variant does not exist. */
  exists: boolean
  /** true when stock is tracked: manage_inventory and at least one inventory item. */
  managed: boolean
  /** Sellable units, floored at 0. 0 when not managed. */
  available: number
}

type VariantRow = {
  id: string
  manage_inventory: boolean
  inventory_items?: {
    required_quantity?: number | null
    inventory?: {
      location_levels?: {
        stocked_quantity?: number | null
        reserved_quantity?: number | null
      }[]
    } | null
  }[]
}

/**
 * Available stock for a variant: for each inventory item, the sum over its
 * inventory levels of (stocked_quantity - reserved_quantity), floored at 0;
 * for a multi-part variant, the minimum over items of floor(item / required).
 * For the usual single item with required_quantity 1 this is exactly the sum
 * over the item's levels.
 */
export async function readVariantStock(
  container: Pick<MedusaContainer, "resolve">,
  variantId: string
): Promise<VariantStock> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "manage_inventory",
      "inventory_items.required_quantity",
      "inventory_items.inventory.location_levels.stocked_quantity",
      "inventory_items.inventory.location_levels.reserved_quantity",
    ],
    filters: { id: variantId },
  })
  const variant = (data as VariantRow[])[0]
  if (!variant) return { exists: false, managed: false, available: 0 }
  const items = variant.inventory_items ?? []
  if (!variant.manage_inventory || !items.length) {
    return { exists: true, managed: false, available: 0 }
  }
  const perItem = items.map((item) => {
    const levels = item.inventory?.location_levels ?? []
    const total = Math.max(
      0,
      levels.reduce(
        (s, l) =>
          s + Number(l.stocked_quantity ?? 0) - Number(l.reserved_quantity ?? 0),
        0
      )
    )
    const required = Math.max(1, Number(item.required_quantity ?? 1))
    return Math.floor(total / required)
  })
  return { exists: true, managed: true, available: Math.min(...perItem) }
}

export const channelOfferLockKey = (variantId: string) =>
  `channel-offers:${variantId}`
