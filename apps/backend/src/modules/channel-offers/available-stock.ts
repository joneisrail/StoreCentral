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
export const VARIANT_STOCK_FIELDS = [
  "id",
  "manage_inventory",
  "inventory_items.required_quantity",
  "inventory_items.inventory.location_levels.stocked_quantity",
  "inventory_items.inventory.location_levels.reserved_quantity",
]

/**
 * The one available-stock formula. `net` is the sum over the item levels of
 * (stocked - reserved), unfloored. Used by the per-variant read and by the
 * grid bulk read so the semantics cannot drift.
 */
export function availableFromItems(
  managed: boolean,
  items: { required_quantity?: number | null; net: number }[]
): number {
  if (!managed || !items.length) return 0
  return Math.min(
    ...items.map((i) =>
      Math.floor(
        Math.max(0, i.net) / Math.max(1, Number(i.required_quantity ?? 1))
      )
    )
  )
}

/** The available-stock rule applied to a variant row read with VARIANT_STOCK_FIELDS. */
export function availableFromVariantRow(variant: VariantRow): number {
  return availableFromItems(
    !!variant.manage_inventory,
    (variant.inventory_items ?? []).map((item) => ({
      required_quantity: item.required_quantity,
      net: (item.inventory?.location_levels ?? []).reduce(
        (s, l) => s + Number(l.stocked_quantity ?? 0) - Number(l.reserved_quantity ?? 0),
        0
      ),
    }))
  )
}

export async function readVariantStock(
  container: Pick<MedusaContainer, "resolve">,
  variantId: string
): Promise<VariantStock> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: "product_variant",
    fields: VARIANT_STOCK_FIELDS,
    filters: { id: variantId },
  })
  const variant = (data as VariantRow[])[0]
  if (!variant) return { exists: false, managed: false, available: 0 }
  const items = variant.inventory_items ?? []
  if (!variant.manage_inventory || !items.length) {
    return { exists: true, managed: false, available: 0 }
  }
  return { exists: true, managed: true, available: availableFromVariantRow(variant) }
}

export const channelOfferLockKey = (variantId: string) =>
  `channel-offers:${variantId}`
