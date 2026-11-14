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
// Limits (documented, not hidden):
// - Child-entity lookups (line items, fulfillments, their links, shipping
//   methods) cannot be pushed into the final order query (they are other
//   entities or modules), so each is capped at CANDIDATE_CAP rows (link
//   lookups at 2.5x). Every capped fetch is ordered newest first
//   (created_at DESC, id DESC) so a hit cap keeps the NEWEST candidates, and
//   hitting a cap sets `truncated`. Candidates are ordered by the child row's
//   created_at, which approximates but is not identical to order recency (for
//   example a fulfillment created later for an older order).
// - Canceled fulfillments (voided labels) never match carrier, ship_from or
//   tracking number.
// - Order text verification (only for text containing wildcard characters)
//   covers exactly the fields core `q` searches: display_id,
//   custom_display_id, email and the shipping/billing address fields company,
//   first_name, last_name, address_1, address_2, city, province, postal_code,
//   phone. Core `q` tokenises on whitespace and ANDs tokens; the verify step
//   treats the text as one literal string.
// - order_item keeps one row per order version, so an item removed by an order
//   edit can still match its order.
// Search text is never logged.

export const MAX_RESULTS = 200
export const CANDIDATE_CAP = 2000
const LINK_CAP_FACTOR = 2.5

export type SearchOptions = { candidateCap?: number; maxResults?: number }

const NEWEST_FIRST = { created_at: "DESC", id: "DESC" } as const
const ADDRESS_FIELDS = [
  "company",
  "first_name",
  "last_name",
  "address_1",
  "address_2",
  "city",
  "province",
  "postal_code",
  "phone",
] as const

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
  readonly cap: number
  readonly linkCap: number
  constructor(
    private readonly query: QueryLike,
    cap: number
  ) {
    this.cap = cap
    this.linkCap = Math.ceil(cap * LINK_CAP_FACTOR)
  }

  // Every capped fetch is ordered newest first so a hit cap keeps the newest rows.
  async fetch(args: GraphArgs, cap = this.cap): Promise<any[]> {
    const { data } = await this.query.graph({
      ...args,
      pagination: { take: cap, order: { ...NEWEST_FIRST }, ...args.pagination },
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
        ? [
            "id",
            "display_id",
            "custom_display_id",
            "email",
            ...ADDRESS_FIELDS.map((f) => `shipping_address.${f}`),
            ...ADDRESS_FIELDS.map((f) => `billing_address.${f}`),
          ]
        : ["id"],
      filters: { q: p.verify ? longestLiteralSegment(text) : text, is_draft_order: false },
    })
    const kept = p.verify
      ? rows.filter((r) =>
          containsLiteral(
            [
              r.display_id,
              r.custom_display_id,
              r.email,
              ...ADDRESS_FIELDS.map((f) => r.shipping_address?.[f]),
              ...ADDRESS_FIELDS.map((f) => r.billing_address?.[f]),
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
      this.linkCap
    )
    return new Set(links.map((l) => l.order_id as string))
  }

  async orderIdsForFulfillments(fulfillmentIds: string[]): Promise<Set<string>> {
    if (!fulfillmentIds.length) return new Set()
    const links = await this.fetch(
      { entity: "order_fulfillment", fields: ["order_id", "fulfillment_id"], filters: { fulfillment_id: fulfillmentIds } },
      this.linkCap
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
      filters: { labels: { tracking_number: { $ilike: p.like } }, canceled_at: null },
    })
    const kept = p.verify
      ? ful.filter((f) => containsLiteral((f.labels ?? []).map((l: any) => l?.tracking_number), text))
      : ful
    return this.orderIdsForFulfillments(kept.map((f) => f.id))
  }

  // carrier (case-insensitive equals over three JSON paths) and ship_from
  // (location id) on the same fulfillment.
  async fulfillmentOrderIds(carrier?: string, shipFrom?: string): Promise<Set<string>> {
    const filters: Record<string, unknown> = { canceled_at: null }
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

export async function searchOrders(
  query: QueryLike,
  params: SearchParams,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const maxResults = options.maxResults ?? MAX_RESULTS
  const s = new Search(query, options.candidateCap ?? CANDIDATE_CAP)
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
    pagination: { take: maxResults + 1, order: { ...NEWEST_FIRST } },
  })
  return {
    order_ids: data.slice(0, maxResults).map((o) => o.id as string),
    truncated: data.length > maxResults || s.capped,
  }
}
