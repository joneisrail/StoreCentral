import type { ChannelListing } from "../sync/channel-import.js"
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
  name?: string | null
  stock_quantity?: number | null
  images?: { src?: string | null }[] | null
  image?: { src?: string | null } | null
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

const toChannelListing = (
  p: RawProduct,
  parent: RawProduct | null,
  sku: string | null
): ChannelListing => ({
  externalId: String(p.id),
  parentExternalId: parent ? String(parent.id) : null,
  sku,
  title: p.name || parent?.name || "",
  parentTitle: parent ? (parent.name ?? null) : null,
  price: p.regular_price || p.price || "",
  stock: typeof p.stock_quantity === "number" ? p.stock_quantity : null,
  imageUrl:
    p.images?.[0]?.src || p.image?.src || parent?.images?.[0]?.src || null,
  currency: null,
})

const rawSku = (p: RawProduct): string | null => {
  const s = p.sku ?? ""
  return s.trim() === "" ? null : s
}

/**
 * Read-only catalogue of simple products and variations, SKU-less entries
 * included (sku null). Used by the channel import; GET requests only.
 */
export const listWooCatalog = async (
  client: WooCommerceClient
): Promise<ChannelListing[]> => {
  const out: ChannelListing[] = []
  const products = await fetchAll<RawProduct>(client, "/products")
  for (const p of products) {
    if (p.type === "simple") out.push(toChannelListing(p, null, rawSku(p)))
    if (p.type === "variable") {
      const variations = await fetchAll<RawProduct>(
        client,
        `/products/${p.id}/variations`
      )
      for (const v of variations) {
        const inherited = (v.sku ?? "").trim() === (p.sku ?? "").trim()
        out.push(toChannelListing(v, p, inherited ? null : rawSku(v)))
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
