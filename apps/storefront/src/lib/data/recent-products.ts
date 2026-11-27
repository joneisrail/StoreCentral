"use server"

import { HttpTypes } from "@medusajs/types"
import { RECENT_CAP } from "@lib/util/recently-viewed"
import { listProducts } from "./products"

export async function listProductsByIds(
  ids: string[],
  countryCode: string
): Promise<HttpTypes.StoreProduct[]> {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return []
    }

    const wanted = ids.slice(0, RECENT_CAP)

    const { response } = await listProducts({
      queryParams: { id: wanted, limit: wanted.length },
      countryCode,
    })

    const byId = new Map(response.products.map((p) => [p.id, p]))
    return wanted
      .map((id) => byId.get(id))
      .filter((p): p is HttpTypes.StoreProduct => Boolean(p))
  } catch {
    return []
  }
}
