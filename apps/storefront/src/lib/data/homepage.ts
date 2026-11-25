import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import {
  PRODUCT_SECTIONS,
  ResolvedSection,
  resolveProductSections,
} from "@lib/content/homepage-sections"
import { HttpTypes } from "@medusajs/types"

export type TileCategory = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
}

const CATEGORY_FIELDS =
  "id,name,handle,parent_category_id,metadata,*category_children"

// Top-level only (children arrive through *category_children) with a limit
// far above any realistic catalogue, so "brands" is never paged out.
const CATEGORY_QUERY = {
  fields: CATEGORY_FIELDS,
  parent_category_id: "null",
  limit: 1000,
}

export const MAX_BRAND_TILES = 12

const toTile = (
  c: Pick<HttpTypes.StoreProductCategory, "id" | "name" | "handle" | "metadata">
): TileCategory | null => {
  if (!c.handle) {
    return null
  }
  const image = c.metadata?.image_url
  return {
    id: c.id,
    name: c.name,
    handle: c.handle,
    imageUrl:
      typeof image === "string" && image.startsWith("https://") ? image : null,
  }
}

const compact = (tiles: (TileCategory | null)[]): TileCategory[] =>
  tiles.filter((t): t is TileCategory => t !== null)

export const pickBrands = (
  categories: HttpTypes.StoreProductCategory[]
): TileCategory[] => {
  const brands = categories.find((c) => c.handle === "brands")
  if (!brands) {
    return []
  }
  return compact((brands.category_children ?? []).map((c) => toTile(c))).slice(
    0,
    MAX_BRAND_TILES
  )
}

export const pickShopCategories = (
  categories: HttpTypes.StoreProductCategory[]
): TileCategory[] =>
  compact(
    categories
      .filter((c) => !c.parent_category_id && c.handle !== "brands")
      .map((c) => toTile(c))
  )

export const getHomepageSections = async (
  countryCode: string
): Promise<{
  region: HttpTypes.StoreRegion
  sections: ResolvedSection[]
} | null> => {
  try {
    const region = await getRegion(countryCode)
    if (!region) {
      return null
    }
    const { collections } = await listCollections({})
    return {
      region,
      sections: resolveProductSections(PRODUCT_SECTIONS, collections),
    }
  } catch {
    console.error("homepage: getHomepageSections failed")
    return null
  }
}

export const listSectionProducts = async (
  section: ResolvedSection,
  regionId: string,
  limit = 8
): Promise<HttpTypes.StoreProduct[]> => {
  try {
    const queryParams =
      section.kind === "latest"
        ? { limit, order: "-created_at", fields: "*variants.calculated_price" }
        : {
            limit,
            collection_id: [section.collection.id],
            fields: "*variants.calculated_price",
          }
    const {
      response: { products },
    } = await listProducts({ regionId, queryParams })
    return products
  } catch {
    console.error("homepage: listSectionProducts failed")
    return []
  }
}

export const listBrandTiles = async (): Promise<TileCategory[]> => {
  try {
    return pickBrands(await listCategories(CATEGORY_QUERY))
  } catch {
    console.error("homepage: listBrandTiles failed")
    return []
  }
}

export const listShopTiles = async (): Promise<TileCategory[]> => {
  try {
    return pickShopCategories(await listCategories(CATEGORY_QUERY))
  } catch {
    console.error("homepage: listShopTiles failed")
    return []
  }
}
