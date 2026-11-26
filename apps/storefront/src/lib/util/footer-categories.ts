import type { HttpTypes } from "@medusajs/types"

/** Brands live under this top-level category; they are not shop categories. */
export const BRANDS_CATEGORY_HANDLE = "brands"

const MAX_FOOTER_CATEGORIES = 6

/**
 * The top-level categories the footer lists. The brands category and its
 * (possibly hundreds of) children are left out: brands have their own entry
 * points, and a wall of brand links would repeat on every page.
 */
export function footerCategories(
  categories: HttpTypes.StoreProductCategory[] | null | undefined
) {
  return (categories ?? [])
    .filter((c) => !c.parent_category && c.handle !== BRANDS_CATEGORY_HANDLE)
    .slice(0, MAX_FOOTER_CATEGORIES)
}
