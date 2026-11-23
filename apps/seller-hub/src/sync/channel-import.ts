export type ChannelListing = {
  externalId: string
  parentExternalId: string | null
  sku: string | null
  title: string
  parentTitle: string | null
  price: string
  stock: number | null
  imageUrl: string | null
  currency: string | null
  /** Shopify only: the variant's InventoryItem gid, stored as external_inventory_item_id. */
  inventoryItemId?: string | null
}

export type StoreVariant = { variantId: string; productId: string; sku: string }

export type ImportPlan = {
  matched: ChannelListing[]
  unmatched: ChannelListing[]
  duplicates: string[]
  noSku: ChannelListing[]
}

export const IMPORT_RUN_CAP = 200

// Shopify names the only variant of a single-variant product "Default Title".
const SHOPIFY_DEFAULT_VARIANT_TITLE = "Default Title"

/**
 * Draft product title for a listing: "parent - variant" when both exist and
 * differ, else the variant title. Shopify's "Default Title" variant name is
 * dropped in favour of the parent title. Falls back to the trimmed SKU.
 */
export const titleOf = (listing: ChannelListing): string => {
  const { parentTitle } = listing
  const variant = listing.title === SHOPIFY_DEFAULT_VARIANT_TITLE ? "" : listing.title
  if (variant && parentTitle && parentTitle !== variant) return `${parentTitle} - ${variant}`
  return variant || parentTitle || listing.title || (listing.sku ?? "").trim()
}

const normalize = (sku: string | null): string | null => {
  const trimmed = sku?.trim()
  return trimmed ? trimmed : null
}

const countBy = (skus: string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const sku of skus) counts.set(sku, (counts.get(sku) ?? 0) + 1)
  return counts
}

export const planImport = (channel: ChannelListing[], store: StoreVariant[]): ImportPlan => {
  const channelSkus = channel.map((l) => normalize(l.sku))
  const storeSkus = store.map((v) => (v.sku ?? '').trim()).filter((s) => s !== '')
  const channelCounts = countBy(channelSkus.filter((s): s is string => s !== null))
  const storeCounts = countBy(storeSkus)

  const duplicates = new Set<string>()
  for (const [sku, n] of channelCounts) if (n > 1) duplicates.add(sku)
  // store-side duplicates only matter when the channel also carries the SKU
  for (const [sku, n] of storeCounts) if (n > 1 && channelCounts.has(sku)) duplicates.add(sku)

  const matched: ChannelListing[] = []
  const unmatched: ChannelListing[] = []
  const noSku: ChannelListing[] = []
  channel.forEach((listing, i) => {
    const sku = channelSkus[i]
    if (sku === null) {
      noSku.push(listing)
    } else if (duplicates.has(sku)) {
      // reported in duplicates, never imported
    } else if (storeCounts.get(sku) === 1) {
      matched.push(listing)
    } else {
      unmatched.push(listing)
    }
  })

  // A variable parent with any duplicate or no-SKU variation is skipped as a whole.
  const poisoned = new Set<string>()
  channel.forEach((listing, i) => {
    const sku = channelSkus[i]
    if (listing.parentExternalId !== null && (sku === null || duplicates.has(sku))) {
      poisoned.add(listing.parentExternalId)
    }
  })

  const kept: ChannelListing[] = []
  for (const listing of unmatched) {
    if (listing.parentExternalId !== null && poisoned.has(listing.parentExternalId)) {
      const sku = normalize(listing.sku)
      if (sku !== null) duplicates.add(sku)
    } else {
      kept.push(listing)
    }
  }

  return { matched, unmatched: kept, duplicates: [...duplicates], noSku }
}
