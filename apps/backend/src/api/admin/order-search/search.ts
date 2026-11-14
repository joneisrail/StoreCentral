// Order search: pure matching logic over a Query-graph-like object.
//
// Field support (proved by integration-tests/http/order-search-fields.spec.ts):
// - order `q` (core free-text search), `shipping_address.country_code`,
//   `shipping_methods.shipping_method_id` filter at the data layer;
// - `order_line_item` (variant_sku/title/product_title), `order_item`
//   (order_id <-> item_id), `order_shipping_method` (name) are queryable entities;
// - `fulfillment` filters on `location_id`, `labels.tracking_number` and JSON
//   `data.*` / `metadata.*` paths with `$ilike`; the order link is `order_fulfillment`.
//
// LIKE wildcards: the Query layer gives no reliable way to escape `%`, `_` and
// `\`, so user text containing any of them is never put into a pattern.
// Instead the longest wildcard-free segment is used as a data-layer prefilter
// (a superset) and the candidates are verified with a literal, case-insensitive
// comparison. Text made only of wildcard characters matches nothing. Text
// without those characters is used directly as a bound `%text%` value.
//
// Each candidate branch is capped at CANDIDATE_CAP rows; hitting the cap sets
// `truncated`. Search text is never logged.

export const MAX_RESULTS = 200
export const CANDIDATE_CAP = 2000
const ORDER_ITEM_CAP = 5000

export type SearchParams = {
  q?: string
  sku?: string
  country?: string
  carrier?: string
  ship_from?: string
  delivery?: string
}

export type SearchResult = { order_ids: string[]; truncated: boolean }

type GraphArgs = {
  entity: string
  fields: string[]
  filters?: Record<string, unknown>
  pagination?: { take?: number; order?: Record<string, "ASC" | "DESC"> }
}
export type QueryLike = { graph: (args: GraphArgs) => Promise<{ data: any[] }> }

const WILDCARDS = /[%_\\]/
const WILDCARD_RUNS = /[%_\\]+/

export const hasWildcards = (text: string): boolean => WILDCARDS.test(text)

export const longestLiteralSegment = (text: string): string =>
  text.split(WILDCARD_RUNS).reduce((best, seg) => (seg.length > best.length ? seg : best), "")

const norm = (v: unknown): string => String(v).toLowerCase()

export const containsLiteral = (haystacks: unknown[], text: string): boolean => {
  const needle = norm(text)
  return haystacks.some((h) => h !== null && h !== undefined && norm(h).includes(needle))
}

type Pattern = { like: string; text: string; verify: boolean }

// `%text%` (or exact `text`) pattern for a user text, or null when it has no
// literal character to search for.
const toPattern = (text: string, exact = false): Pattern | null => {
  if (!hasWildcards(text)) return { like: exact ? text : `%${text}%`, text, verify: false }
  const seg = longestLiteralSegment(text)
  if (!seg) return null
  return { like: `%${seg}%`, text, verify: true }
}

class Search {
  capped = false
  constructor(private readonly query: QueryLike) {}

  async fetch(args: GraphArgs, cap = CANDIDATE_CAP): Promise<any[]> {
    const { data } = await this.query.graph({
      ...args,
      pagination: { take: cap, ...args.pagination },
    })
    if (data.length >= cap) this.capped = true
    return data
  }

  // (a) the order module's own `q` search.
  async orderTextIds(text: string): Promise<Set<string>> {
    const p = toPattern(text)
    if (!p) return new Set()
    const rows = await this.fetch({
      entity: "order",
      fields: p.verify
        ? ["id", "display_id", "custom_display_id", "email", "shipping_address.*", "billing_address.*"]
        : ["id"],
      filters: { q: p.verify ? longestLiteralSegment(text) : text, is_draft_order: false },
      pagination: { order: { created_at: "DESC" } },
    })
    const kept = p.verify
      ? rows.filter((r) =>
          containsLiteral(
            [
              r.display_id,
              r.custom_display_id,
              r.email,
              ...Object.values(r.shipping_address ?? {}),
              ...Object.values(r.billing_address ?? {}),
            ],
            text
          )
        )
      : rows
    return new Set(kept.map((r) => r.id))
  }

  // (b) orders with a line item whose given fields match.
  async lineItemOrderIds(text: string, fields: string[]): Promise<Set<string>> {
    const p = toPattern(text)
    if (!p) return new Set()
    const items = await this.fetch({
      entity: "order_line_item",
      fields: ["id", ...fields],
      filters: { $or: fields.map((f) => ({ [f]: { $ilike: p.like } })) },
    })
    const kept = p.verify ? items.filter((i) => containsLiteral(fields.map((f) => i[f]), text)) : items
    const itemIds = [...new Set(kept.map((i) => i.id as string))]
    if (!itemIds.length) return new Set()
    const links = await this.fetch(
      { entity: "order_item", fields: ["order_id", "item_id"], filters: { item_id: itemIds } },
      ORDER_ITEM_CAP
    )
    return new Set(links.map((l) => l.order_id as string))
  }

  async orderIdsForFulfillments(fulfillmentIds: string[]): Promise<Set<string>> {
    if (!fulfillmentIds.length) return new Set()
    const links = await this.fetch(
      { entity: "order_fulfillment", fields: ["order_id", "fulfillment_id"], filters: { fulfillment_id: fulfillmentIds } },
      ORDER_ITEM_CAP
    )
    return new Set(links.map((l) => l.order_id as string))
  }

  // (c) orders with a fulfillment label whose tracking number matches.
  async trackingOrderIds(text: string): Promise<Set<string>> {
    const p = toPattern(text)
    if (!p) return new Set()
    const ful = await this.fetch({
      entity: "fulfillment",
      fields: ["id", "labels.tracking_number"],
      filters: { labels: { tracking_number: { $ilike: p.like } } },
    })
    const kept = p.verify
      ? ful.filter((f) => containsLiteral((f.labels ?? []).map((l: any) => l?.tracking_number), text))
      : ful
    return this.orderIdsForFulfillments(kept.map((f) => f.id))
  }

  // carrier (case-insensitive equals over three JSON paths) and ship_from
  // (location id) on the same fulfillment.
  async fulfillmentOrderIds(carrier?: string, shipFrom?: string): Promise<Set<string>> {
    const filters: Record<string, unknown> = {}
    let p: Pattern | null = null
    if (shipFrom) filters.location_id = shipFrom
    if (carrier) {
      p = toPattern(carrier, true)
      if (!p) return new Set()
      filters.$or = [
        { data: { easypost_carrier: { $ilike: p.like } } },
        { data: { carrier: { $ilike: p.like } } },
        { metadata: { carrier: { $ilike: p.like } } },
      ]
    }
    const ful = await this.fetch({ entity: "fulfillment", fields: ["id", "data", "metadata"], filters })
    const kept =
      p?.verify && carrier
        ? ful.filter((f) =>
            [f.data?.easypost_carrier, f.data?.carrier, f.metadata?.carrier].some(
              (v) => typeof v === "string" && norm(v) === norm(carrier)
            )
          )
        : ful
    return this.orderIdsForFulfillments(kept.map((f) => f.id))
  }

  async shippingMethodIds(text: string): Promise<string[]> {
    const p = toPattern(text)
    if (!p) return []
    const rows = await this.fetch({
      entity: "order_shipping_method",
      fields: ["id", "name"],
      filters: { name: { $ilike: p.like } },
    })
    return (p.verify ? rows.filter((r) => containsLiteral([r.name], text)) : rows).map((r) => r.id)
  }
}

const union = (...sets: Set<string>[]): Set<string> => new Set(sets.flatMap((s) => [...s]))

const intersect = (sets: Set<string>[]): string[] => {
  const [first, ...rest] = sets
  return [...first].filter((id) => rest.every((s) => s.has(id)))
}

export async function searchOrders(query: QueryLike, params: SearchParams): Promise<SearchResult> {
  const s = new Search(query)
  const empty: SearchResult = { order_ids: [], truncated: false }
  const restrictions: Set<string>[] = []
  const filters: Record<string, unknown> = { is_draft_order: false }

  if (params.q) {
    const [a, b, c] = await Promise.all([
      s.orderTextIds(params.q),
      s.lineItemOrderIds(params.q, ["variant_sku", "title", "product_title"]),
      s.trackingOrderIds(params.q),
    ])
    restrictions.push(union(a, b, c))
  }
  if (params.sku) restrictions.push(await s.lineItemOrderIds(params.sku, ["variant_sku"]))
  if (params.carrier || params.ship_from) {
    restrictions.push(await s.fulfillmentOrderIds(params.carrier, params.ship_from))
  }
  if (params.delivery) {
    const methodIds = await s.shippingMethodIds(params.delivery)
    if (!methodIds.length) return empty
    filters.shipping_methods = { shipping_method_id: methodIds }
  }
  if (params.country) filters.shipping_address = { country_code: { $ilike: params.country } }

  if (restrictions.length) {
    if (restrictions.some((r) => r.size === 0)) return { order_ids: [], truncated: s.capped }
    filters.id = intersect(restrictions)
    if (!(filters.id as string[]).length) return { order_ids: [], truncated: s.capped }
  }

  const { data } = await query.graph({
    entity: "order",
    fields: ["id"],
    filters,
    pagination: { take: MAX_RESULTS + 1, order: { created_at: "DESC" } },
  })
  return {
    order_ids: data.slice(0, MAX_RESULTS).map((o) => o.id as string),
    truncated: data.length > MAX_RESULTS || s.capped,
  }
}
