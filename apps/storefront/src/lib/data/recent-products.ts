"use server"

import { HttpTypes } from "@medusajs/types"
import { listProducts } from "./products"

export async function listProductsByIds(
  ids: string[],
  countryCode: string
): Promise<HttpTypes.StoreProduct[]> {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return []
    }

    const { response } = await listProducts({
      queryParams: { id: ids, limit: ids.length },
      countryCode,
    })

    const byId = new Map(response.products.map((p) => [p.id, p]))
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is HttpTypes.StoreProduct => Boolean(p))
  } catch {
    return []
  }
}
