import {
  CANDIDATE_CAP,
  MAX_RESULTS,
  containsLiteral,
  hasWildcards,
  longestLiteralSegment,
  searchOrders,
} from "../search"
import { OrderSearchQuerySchema } from "../middlewares"

type Call = { entity: string; filters?: any; fields?: string[]; pagination?: any }

// A mocked Query graph: handlers keyed by entity name, every call recorded.
const makeQuery = (handlers: Record<string, (c: Call) => any[]>) => {
  const calls: Call[] = []
  const graph = jest.fn(async (c: Call) => {
    calls.push(c)
    const h = handlers[c.entity]
    if (!h) throw new Error(`unexpected entity ${c.entity}`)
    return { data: h(c) }
  })
  return { query: { graph } as any, calls }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `order_${i}` }))

describe("OrderSearchQuerySchema", () => {
  const parse = (v: unknown) => OrderSearchQuerySchema.safeParse(v)

  it("accepts one param and normalises q (trim) and country (upper-case)", () => {
    expect(parse({ q: "  abc " })).toMatchObject({ success: true, data: { q: "abc" } })
    expect(parse({ country: "us" })).toMatchObject({ success: true, data: { country: "US" } })
  })
  it("rejects q shorter than 2 (after trimming) or longer than 100", () => {
    expect(parse({ q: "a" }).success).toBe(false)
    expect(parse({ q: " a " }).success).toBe(false)
    expect(parse({ q: "a".repeat(101) }).success).toBe(false)
    expect(parse({ q: "a".repeat(100) }).success).toBe(true)
  })
  it("rejects empty input and unknown keys", () => {
    expect(parse({}).success).toBe(false)
    expect(parse({ q: "ab", limit: "5" }).success).toBe(false)
    expect(parse({ q: "ab", fields: "id" }).success).toBe(false)
  })
  it("validates the other params", () => {
    expect(parse({ sku: "" }).success).toBe(false)
    expect(parse({ sku: "x".repeat(101) }).success).toBe(false)
    expect(parse({ country: "usa" }).success).toBe(false)
    expect(parse({ country: "u1" }).success).toBe(false)
    expect(parse({ carrier: "c".repeat(51) }).success).toBe(false)
    expect(parse({ ship_from: "x".repeat(101) }).success).toBe(false)
    expect(parse({ delivery: "d".repeat(101) }).success).toBe(false)
    expect(parse({ sku: "a", country: "GB", carrier: "ups", ship_from: "sloc_1", delivery: "std" }).success).toBe(true)
  })
})

describe("literal helpers", () => {
  it("detects LIKE wildcard characters", () => {
    expect(hasWildcards("abc")).toBe(false)
    expect(hasWildcards("a%c")).toBe(true)
    expect(hasWildcards("a_c")).toBe(true)
    expect(hasWildcards("a\\c")).toBe(true)
  })
  it("returns the longest literal segment between wildcard characters", () => {
    expect(longestLiteralSegment("50%_off")).toBe("off")
    expect(longestLiteralSegment("ab_c")).toBe("ab")
    expect(longestLiteralSegment("%%")).toBe("")
    expect(longestLiteralSegment("a\\b%c")).toBe("a")
    expect(longestLiteralSegment("plain")).toBe("plain")
  })
  it("matches literally and case-insensitively", () => {
    expect(containsLiteral(["Foo 50% Off", null], "50% off")).toBe(true)
    expect(containsLiteral(["Foo 500 Off"], "50% off")).toBe(false)
    expect(containsLiteral(["a-b"], "a_b")).toBe(false)
    expect(containsLiteral([undefined], "a")).toBe(false)
  })
})

describe("searchOrders", () => {
  it("q: unions the order module q search, line items and shipping labels", async () => {
    const { query, calls } = makeQuery({
      order: (c) => (c.filters.q ? [{ id: "o_q" }] : [{ id: "o_q" }, { id: "o_item" }, { id: "o_lbl" }]),
      order_line_item: () => [{ id: "li_1", variant_sku: "ABC-1", title: "t", product_title: "p" }],
      order_item: () => [
        { order_id: "o_item", item_id: "li_1" },
        { order_id: "o_item", item_id: "li_1" },
      ],
      fulfillment: () => [{ id: "f_1", labels: [{ tracking_number: "1Z" }] }],
      order_fulfillment: () => [{ order_id: "o_lbl", fulfillment_id: "f_1" }],
    })
    const res = await searchOrders(query, { q: "abc" })
    expect(res).toEqual({ order_ids: ["o_q", "o_item", "o_lbl"], truncated: false })
    const orderCalls = calls.filter((c) => c.entity === "order")
    expect(orderCalls[0].filters).toMatchObject({ q: "abc", is_draft_order: false })
    const final = orderCalls[orderCalls.length - 1]
    expect([...final.filters.id].sort()).toEqual(["o_item", "o_lbl", "o_q"])
    expect(final.filters.is_draft_order).toBe(false)
    const li = calls.find((c) => c.entity === "order_line_item")!
    expect(li.filters.$or).toEqual([
      { variant_sku: { $ilike: "%abc%" } },
      { title: { $ilike: "%abc%" } },
      { product_title: { $ilike: "%abc%" } },
    ])
    const ful = calls.find((c) => c.entity === "fulfillment")!
    expect(ful.filters).toEqual({ labels: { tracking_number: { $ilike: "%abc%" } } })
  })

  it("AND-combines params: sku, country, carrier, ship_from and delivery narrow the same result", async () => {
    const { query, calls } = makeQuery({
      order: (c) => (c.filters.id ? [{ id: "o_2" }] : []),
      order_line_item: () => [{ id: "li_1", variant_sku: "SKU-1" }],
      order_item: () => [
        { order_id: "o_1", item_id: "li_1" },
        { order_id: "o_2", item_id: "li_1" },
      ],
      fulfillment: () => [{ id: "f_1", data: {}, metadata: {} }],
      order_fulfillment: () => [
        { order_id: "o_2", fulfillment_id: "f_1" },
        { order_id: "o_9", fulfillment_id: "f_1" },
      ],
      order_shipping_method: () => [{ id: "osm_1", name: "Standard" }],
    })
    const res = await searchOrders(query, {
      sku: "sku-1",
      country: "US",
      carrier: "UPS",
      ship_from: "sloc_1",
      delivery: "stand",
    })
    expect(res.order_ids).toEqual(["o_2"])
    const ful = calls.find((c) => c.entity === "fulfillment")!
    expect(ful.filters).toEqual({
      location_id: "sloc_1",
      $or: [
        { data: { easypost_carrier: { $ilike: "UPS" } } },
        { data: { carrier: { $ilike: "UPS" } } },
        { metadata: { carrier: { $ilike: "UPS" } } },
      ],
    })
    const osm = calls.find((c) => c.entity === "order_shipping_method")!
    expect(osm.filters).toEqual({ name: { $ilike: "%stand%" } })
    const final = calls.filter((c) => c.entity === "order").pop()!
    expect(final.filters.id).toEqual(["o_2"])
    expect(final.filters.shipping_address).toEqual({ country_code: { $ilike: "US" } })
    expect(final.filters.shipping_methods).toEqual({ shipping_method_id: ["osm_1"] })
  })

  it("returns empty without a final order query when a restriction matches nothing", async () => {
    const { query, calls } = makeQuery({
      order_line_item: () => [],
      order: () => {
        throw new Error("must not query orders")
      },
    })
    expect(await searchOrders(query, { sku: "nope" })).toEqual({ order_ids: [], truncated: false })
    expect(calls.map((c) => c.entity)).toEqual(["order_line_item"])
  })

  it("orders newest first and asks for MAX_RESULTS + 1 to compute truncation", async () => {
    const { query, calls } = makeQuery({ order: () => ids(MAX_RESULTS + 1) })
    const res = await searchOrders(query, { country: "GB" })
    expect(res.order_ids).toHaveLength(MAX_RESULTS)
    expect(res.truncated).toBe(true)
    expect(res.order_ids[0]).toBe("order_0")
    expect(calls[0].pagination).toEqual({ take: MAX_RESULTS + 1, order: { created_at: "DESC" } })
    const exact = makeQuery({ order: () => ids(MAX_RESULTS) })
    expect(await searchOrders(exact.query, { country: "GB" })).toMatchObject({ truncated: false })
  })

  it("flags truncation when a candidate branch hits the cap", async () => {
    const { query } = makeQuery({
      order_line_item: () => Array.from({ length: CANDIDATE_CAP }, (_, i) => ({ id: `li_${i}`, variant_sku: "abc" })),
      order_item: () => [{ order_id: "o_1", item_id: "li_1" }],
      order: () => [{ id: "o_1" }],
    })
    expect(await searchOrders(query, { sku: "abc" })).toEqual({ order_ids: ["o_1"], truncated: true })
  })

  it("never puts wildcard characters into a pattern: uses the longest literal segment and verifies literally", async () => {
    const { query, calls } = makeQuery({
      order_line_item: () => [
        { id: "li_ok", variant_sku: "A_B-1", title: "x", product_title: "y" },
        { id: "li_wild", variant_sku: "AXB-1", title: "x", product_title: "y" },
      ],
      order_item: (c) => c.filters.item_id.map((i: string) => ({ order_id: `o_${i}`, item_id: i })),
      order: (c) => c.filters.id.map((id: string) => ({ id })),
    })
    const res = await searchOrders(query, { sku: "a_b" })
    expect(res.order_ids).toEqual(["o_li_ok"])
    const li = calls.find((c) => c.entity === "order_line_item")!
    expect(li.filters.$or).toEqual([{ variant_sku: { $ilike: "%a%" } }])
  })

  it("wildcard-only input matches nothing and does not hit the database", async () => {
    const { query, calls } = makeQuery({})
    expect(await searchOrders(query, { q: "%%" })).toEqual({ order_ids: [], truncated: false })
    expect(await searchOrders(query, { sku: "_" })).toEqual({ order_ids: [], truncated: false })
    expect(calls).toHaveLength(0)
  })

  it("q with wildcard characters verifies the order text literally", async () => {
    const { query, calls } = makeQuery({
      order: (c) =>
        c.filters.q
          ? [
              { id: "o_hit", email: "a_b@x.com", shipping_address: { city: "ny" } },
              { id: "o_miss", email: "axb@x.com", shipping_address: { city: "ny" } },
            ]
          : [{ id: "o_hit" }],
      order_line_item: () => [],
      fulfillment: () => [],
    })
    const res = await searchOrders(query, { q: "a_b@x" })
    expect(res.order_ids).toEqual(["o_hit"])
    expect(calls.find((c) => c.entity === "order")!.filters.q).toBe("b@x")
  })
})
