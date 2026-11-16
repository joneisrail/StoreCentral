// Channel pricing grid: read model for GET /admin/channel-offers.
//
// Sorting and paging are server side over ALL matching variants. Method: load
// the key columns of every matching variant (paged, at most VARIANT_CAP), load
// only the extra data the chosen sort needs for all of them (stock levels,
// channel offers, base prices), sort in memory, slice the page, then load the
// remaining data for the page rows only.
//
// Limits (documented, not hidden):
// - At most VARIANT_CAP (20,000) variants take part; beyond that `truncated` is
//   true and the oldest-id variants are kept (ordered by id).
// - At most OFFER_CAP rows of channel_offer are read for an in-memory sort.
// - Search text is matched literally (see order-search/search.ts): `%`, `_` and
//   `\` never reach a LIKE pattern; the longest wildcard-free segment is the
//   data-layer prefilter and candidates are verified case-insensitively. The
//   prefilter itself is capped at VARIANT_CAP like everything else.
// - Search text is never logged.
import {
  containsLiteral,
  hasWildcards,
  longestLiteralSegment,
} from "../order-search/search"
import {
  availableFromVariantRow,
  VARIANT_STOCK_FIELDS,
} from "../../../modules/channel-offers/available-stock"

export const VARIANT_CAP = 20_000
export const OFFER_CAP = 300_000
const VARIANT_PAGE = 1000
const OFFER_PAGE = 10_000
const ID_CHUNK = 500

export type GridParams = {
  q?: string
  order: string
  limit: number
  offset: number
  channel_ids?: string[]
}

export type ChannelKind = "marketplace" | "web" | "pos" | "other"
export type GridChannel = { id: string; name: string; kind: ChannelKind; has_connection: boolean }

type Offer = {
  variant_id: string
  sales_channel_id: string
  price: number | null
  stock: number
  sync_state: string
  last_synced_at: Date | string | null
  last_error: string | null
}

export type GridDeps = {
  query: { graph: (args: any) => Promise<{ data: any[] }> }
  offers: { listChannelOffers: (filters: any, config?: any) => Promise<any[]> }
  /** Sales channel ids that have a marketplace connection; never throws. */
  connectedChannelIds: () => Promise<Set<string>>
}

type VariantKey = {
  id: string
  sku: string | null
  variant_title: string
  product_id: string
  product_title: string
  available?: number
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const chunks = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const CONCURRENCY = 4
async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

type Sort =
  | { kind: "name" | "total" | "unallocated"; desc: boolean }
  | { kind: "stock" | "price"; channel: string; desc: boolean }

export function parseOrder(order: string): Sort {
  const desc = order.startsWith("-")
  const key = desc ? order.slice(1) : order
  if (key === "name" || key === "total" || key === "unallocated") return { kind: key, desc }
  const i = key.lastIndexOf(":")
  return { kind: key.slice(i + 1) as "stock" | "price", channel: key.slice(0, i), desc }
}

// The web store is the store's default sales channel (store.default_sales_channel_id;
// the web store flag `metadata.kind = "web"` also counts). The POS channel is the
// channel named "Point of Sale" (created by scripts/setup-omnichannel.ts) or
// "POS", or flagged `metadata.kind = "pos"`. A channel with a seller-hub
// connection is "marketplace" first. Everything else is "other".
export function channelKind(
  ch: { id: string; name: string; metadata?: Record<string, unknown> | null },
  defaultChannelId: string | null,
  connected: boolean
): ChannelKind {
  if (connected) return "marketplace"
  const flag = typeof ch.metadata?.kind === "string" ? ch.metadata.kind.toLowerCase() : ""
  if (flag === "web" || (defaultChannelId && ch.id === defaultChannelId)) return "web"
  if (flag === "pos" || /^(point of sale|pos)$/i.test(ch.name.trim())) return "pos"
  return "other"
}

async function loadChannels(deps: GridDeps): Promise<GridChannel[]> {
  const [{ data: channels }, { data: stores }, connected] = await Promise.all([
    deps.query.graph({
      entity: "sales_channel",
      fields: ["id", "name", "metadata", "created_at"],
      pagination: { order: { created_at: "ASC", id: "ASC" }, take: 500 },
    }),
    deps.query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"] }),
    deps.connectedChannelIds(),
  ])
  const defaultId: string | null = stores[0]?.default_sales_channel_id ?? null
  return channels.map((c: any) => {
    const has = connected.has(c.id)
    return { id: c.id, name: c.name, kind: channelKind(c, defaultId, has), has_connection: has }
  })
}

// Default store currency: the store's default supported currency, else its
// first one. Base price is the variant's price in that currency with no rules.
async function loadDefaultCurrency(deps: GridDeps): Promise<string | null> {
  const { data } = await deps.query.graph({
    entity: "store",
    fields: ["id", "supported_currencies.currency_code", "supported_currencies.is_default"],
  })
  const list: { currency_code: string; is_default?: boolean }[] = data[0]?.supported_currencies ?? []
  return (list.find((c) => c.is_default) ?? list[0])?.currency_code?.toLowerCase() ?? null
}

async function fetchVariantKeys(
  deps: GridDeps,
  q: string | undefined,
  withStock: boolean
): Promise<{ rows: VariantKey[]; truncated: boolean }> {
  const text = q?.trim()
  let filters: Record<string, unknown> | undefined
  let literal: string | null = null
  if (text) {
    let like: string
    if (hasWildcards(text)) {
      const seg = longestLiteralSegment(text)
      if (!seg) return { rows: [], truncated: false }
      like = `%${seg}%`
      literal = text
    } else {
      like = `%${text}%`
    }
    filters = {
      $or: [
        { sku: { $ilike: like } },
        { title: { $ilike: like } },
        { product: { title: { $ilike: like } } },
      ],
    }
  }
  const fields = [
    "id",
    "sku",
    "title",
    "product.id",
    "product.title",
    ...(withStock ? VARIANT_STOCK_FIELDS.filter((f) => f !== "id") : []),
  ]
  const rows: VariantKey[] = []
  const fetchPage = async (skip: number) => {
    const res = await deps.query.graph({
      entity: "product_variant",
      fields,
      filters,
      pagination: { skip, take: VARIANT_PAGE, order: { id: "ASC" } },
    })
    return res
  }
  const first = await fetchPage(0)
  const total: number = (first as any).metadata?.count ?? first.data.length
  const pages = [first.data]
  const skips: number[] = []
  for (let skip = VARIANT_PAGE; skip < Math.min(total, VARIANT_CAP); skip += VARIANT_PAGE) skips.push(skip)
  pages.push(...(await mapLimited(skips, async (skip) => (await fetchPage(skip)).data)))
  for (const data of pages) {
    for (const v of data) {
      if (literal && !containsLiteral([v.sku, v.title, v.product?.title], literal)) continue
      rows.push({
        id: v.id,
        sku: v.sku ?? null,
        variant_title: v.title ?? "",
        product_id: v.product?.id ?? "",
        product_title: v.product?.title ?? "",
        ...(withStock ? { available: availableFromVariantRow(v) } : {}),
      })
    }
  }
  const truncated = total > VARIANT_CAP
  return { rows, truncated }
}

async function loadAvailable(deps: GridDeps, variantIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  await mapLimited(chunks(variantIds, ID_CHUNK), async (part) => {
    const { data } = await deps.query.graph({
      entity: "product_variant",
      fields: VARIANT_STOCK_FIELDS,
      filters: { id: part },
    })
    for (const v of data) out.set(v.id, availableFromVariantRow(v))
  })
  return out
}

async function loadBasePrices(
  deps: GridDeps,
  variantIds: string[],
  currency: string | null
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!currency) return out
  await mapLimited(chunks(variantIds, ID_CHUNK), async (part) => {
    const { data } = await deps.query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "price_set.prices.amount",
        "price_set.prices.currency_code",
        "price_set.prices.rules_count",
      ],
      filters: { id: part },
    })
    for (const v of data) {
      const prices: any[] = (v.price_set?.prices ?? []).filter(
        (p: any) => String(p.currency_code).toLowerCase() === currency
      )
      // rule-less price first; otherwise the lowest price in the currency
      const plain = prices.filter((p) => !p.rules_count)
      const pool = plain.length ? plain : prices
      if (pool.length) out.set(v.id, Math.min(...pool.map((p) => Number(p.amount))))
    }
  })
  return out
}

type OfferMap = Map<string, Map<string, Offer>>

async function loadOffers(deps: GridDeps, variantIds: string[] | null): Promise<OfferMap> {
  const map: OfferMap = new Map()
  const add = (rows: any[]) => {
    for (const r of rows) {
      let inner = map.get(r.variant_id)
      if (!inner) map.set(r.variant_id, (inner = new Map()))
      inner.set(r.sales_channel_id, {
        variant_id: r.variant_id,
        sales_channel_id: r.sales_channel_id,
        price: num(r.price),
        stock: Number(r.stock ?? 0),
        sync_state: r.sync_state,
        last_synced_at: r.last_synced_at ?? null,
        last_error: r.last_error ?? null,
      })
    }
  }
  if (variantIds) {
    await mapLimited(chunks(variantIds, ID_CHUNK), async (part) => {
      add(await deps.offers.listChannelOffers({ variant_id: part }, { take: null }))
    })
    return map
  }
  for (let skip = 0; skip < OFFER_CAP; skip += OFFER_PAGE) {
    const rows = await deps.offers.listChannelOffers(
      {},
      { skip, take: OFFER_PAGE, order: { id: "ASC" } }
    )
    add(rows)
    if (rows.length < OFFER_PAGE) break
  }
  return map
}

const lower = (s: string) => s.toLowerCase()
const byName = (a: VariantKey, b: VariantKey) =>
  lower(a.product_title).localeCompare(lower(b.product_title)) ||
  lower(a.variant_title).localeCompare(lower(b.variant_title)) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export async function loadGrid(deps: GridDeps, params: GridParams) {
  const sort = parseOrder(params.order)
  const needsStock = sort.kind === "total" || sort.kind === "unallocated"
  const needsAllOffers = sort.kind === "unallocated" || sort.kind === "stock" || sort.kind === "price"

  const [allChannels, currency, found] = await Promise.all([
    loadChannels(deps),
    loadDefaultCurrency(deps),
    fetchVariantKeys(deps, params.q, needsStock),
  ])
  const kindOf = new Map(allChannels.map((c) => [c.id, c.kind]))
  const isFlat = (channelId: string) => {
    const k = kindOf.get(channelId)
    return k === "web" || k === "pos"
  }
  const channels = params.channel_ids?.length
    ? allChannels.filter((c) => params.channel_ids!.includes(c.id))
    : allChannels

  const variants = found.rows
  const all = variants.map((v) => v.id)

  let offers: OfferMap | null = null
  let base: Map<string, number> | null = null
  if (needsAllOffers) offers = await loadOffers(deps, variants.length <= VARIANT_PAGE ? all : null)
  if (sort.kind === "price") base = await loadBasePrices(deps, all, currency)

  const offerOf = (id: string, channel: string) => offers?.get(id)?.get(channel)
  const totalStock = (id: string) => {
    let s = 0
    for (const o of offers?.get(id)?.values() ?? []) s += o.stock
    return s
  }
  const sortValue = (v: VariantKey): number => {
    switch (sort.kind) {
      case "total":
        return v.available ?? 0
      case "unallocated":
        return Math.max(0, (v.available ?? 0) - totalStock(v.id))
      case "stock":
        return offerOf(v.id, sort.channel)?.stock ?? 0
      case "price": {
        const b = base?.get(v.id) ?? 0
        if (isFlat(sort.channel)) return b
        return offerOf(v.id, sort.channel)?.price ?? b
      }
      default:
        return 0
    }
  }

  if (sort.kind === "name") {
    variants.sort((a, b) => (sort.desc ? -byName(a, b) : byName(a, b)))
  } else {
    const dir = sort.desc ? -1 : 1
    const keyed = new Map(variants.map((v) => [v.id, sortValue(v)]))
    variants.sort((a, b) => dir * (keyed.get(a.id)! - keyed.get(b.id)!) || byName(a, b))
  }

  const page = variants.slice(params.offset, params.offset + params.limit)
  const pageIds = page.map((v) => v.id)
  const [pageOffers, pageBase, pageAvailable] = await Promise.all([
    offers ?? loadOffers(deps, pageIds),
    base ?? loadBasePrices(deps, pageIds, currency),
    needsStock ? null : loadAvailable(deps, pageIds),
  ])
  offers = pageOffers

  const rows = page.map((v) => {
    const available = v.available ?? pageAvailable?.get(v.id) ?? 0
    const baseValue = pageBase.get(v.id)
    const effectiveBase = baseValue ?? 0
    const perChannel: Record<string, unknown> = {}
    for (const ch of channels) {
      const o = offers!.get(v.id)?.get(ch.id)
      const price = o?.price ?? null
      perChannel[ch.id] = {
        price,
        effective_price: ch.kind === "web" || ch.kind === "pos" ? effectiveBase : price ?? effectiveBase,
        stock: o?.stock ?? 0,
        sync_state: o?.sync_state ?? "pending",
        last_synced_at: o?.last_synced_at ?? null,
        last_error: o?.last_error ?? null,
        has_connection: ch.has_connection,
      }
    }
    const allocated = (() => {
      let s = 0
      for (const o of offers!.get(v.id)?.values() ?? []) s += o.stock
      return s
    })()
    return {
      variant_id: v.id,
      product_id: v.product_id,
      product_title: v.product_title,
      variant_title: v.variant_title,
      sku: v.sku,
      base_price: baseValue ?? null,
      available,
      unallocated: Math.max(0, available - allocated),
      channels: perChannel,
    }
  })

  return { rows, channels, count: variants.length, truncated: found.truncated }
}
