import type { WooCommerceClient } from "./client.js"

export type WooListing = {
  id: number
  parentId: number | null
  sku: string
  price: string
}

type RawProduct = {
  id: number
  sku?: string | null
  type?: string
  regular_price?: string | null
  price?: string | null
}

const PER_PAGE = 100

const fetchAll = async <T>(
  client: WooCommerceClient,
  path: string
): Promise<T[]> => {
  const out: T[] = []
  let page = 1
  while (true) {
    const { data, totalPages } = await client.request<T[]>("GET", path, {
      query: { per_page: PER_PAGE, page },
    })
    out.push(...data)
    if (page >= totalPages) return out
    page += 1
  }
}

const toListing = (
  p: RawProduct,
  parentId: number | null
): WooListing | null => {
  const sku = (p.sku ?? "").trim()
  if (sku === "") return null
  return { id: p.id, parentId, sku, price: p.regular_price || p.price || "" }
}

/**
 * Every product plus the variations of variable products. Entries without a
 * SKU cannot be linked, so they are omitted.
 */
export const listWooListings = async (
  client: WooCommerceClient
): Promise<WooListing[]> => {
  const out: WooListing[] = []
  const products = await fetchAll<RawProduct>(client, "/products")
  for (const p of products) {
    // Only simple products and variations are sellable units; variable,
    // grouped and external parents are not linkable.
    if (p.type === "simple") {
      const own = toListing(p, null)
      if (own) out.push(own)
    }
    if (p.type === "variable") {
      const variations = await fetchAll<RawProduct>(
        client,
        `/products/${p.id}/variations`
      )
      for (const v of variations) {
        // A variation without its own SKU can inherit the parent's; that is
        // not a distinct sellable SKU and must not be linked.
        if ((v.sku ?? "").trim() === (p.sku ?? "").trim()) continue
        const listing = toListing(v, p.id)
        if (listing) out.push(listing)
      }
    }
  }
  return out
}

const productPath = (id: number, parentId: number | null): string =>
  parentId === null
    ? `/products/${id}`
    : `/products/${parentId}/variations/${id}`

export const setWooStock = async (
  client: WooCommerceClient,
  target: { id: number; parentId: number | null; quantity: number }
): Promise<void> => {
  const q = Number.isFinite(target.quantity)
    ? Math.max(0, Math.floor(target.quantity))
    : 0
  await client.request("PUT", productPath(target.id, target.parentId), {
    body: { manage_stock: true, stock_quantity: q },
  })
}

export const setWooPrice = async (
  client: WooCommerceClient,
  target: { id: number; parentId: number | null; price: string }
): Promise<void> => {
  await client.request("PUT", productPath(target.id, target.parentId), {
    body: { regular_price: target.price },
  })
}
