import { HttpTypes } from "@medusajs/types"

export type Availability = {
  state: "in_stock" | "backorder" | "out_of_stock"
  max: number | null
}

export const getAvailability = (
  variant:
    | Pick<
        HttpTypes.StoreProductVariant,
        "manage_inventory" | "allow_backorder" | "inventory_quantity"
      >
    | undefined
): Availability => {
  if (!variant) {
    return { state: "out_of_stock", max: 0 }
  }
  if (!variant.manage_inventory) {
    return { state: "in_stock", max: null }
  }
  if (variant.allow_backorder) {
    return { state: "backorder", max: null }
  }
  const quantity = variant.inventory_quantity ?? 0
  if (quantity > 0) {
    return { state: "in_stock", max: quantity }
  }
  return { state: "out_of_stock", max: 0 }
}

export const availabilityLabel = (a: Availability): string => {
  if (a.state === "in_stock") return "In stock"
  if (a.state === "backorder") return "Available to order"
  return "Out of stock"
}
