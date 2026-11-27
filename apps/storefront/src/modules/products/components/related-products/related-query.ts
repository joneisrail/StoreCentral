import { HttpTypes } from "@medusajs/types"

export const buildRelatedQuery = (
  product: HttpTypes.StoreProduct
): { category_id?: string[]; collection_id?: string[] } => {
  const categories = (product.categories ?? []).filter(Boolean)
  const brand = categories.find(
    (category) => category.parent_category?.handle === "brands"
  )
  if (brand) {
    return { category_id: [brand.id] }
  }

  const other = categories.find((category) => category.handle !== "brands")
  if (other) {
    return { category_id: [other.id] }
  }

  if (product.collection_id) {
    return { collection_id: [product.collection_id] }
  }

  return {}
}
