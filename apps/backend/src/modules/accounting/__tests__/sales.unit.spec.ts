import { buildSalesReport, resolveRange } from "../sales"

type Item = {
  variant_id: string | null
  product_id: string | null
  title: string
  quantity: unknown
  subtotal: unknown
  discount_subtotal: unknown
}

const item = (over: Partial<Item> = {}): Item => ({
  variant_id: "var_1",
  product_id: "prod_1",
  title: "Widget",
  quantity: 1,
  subtotal: 10,
  discount_subtotal: 0,
  ...over,
})

const order = (
  created_at: string,
  over: Record<string, unknown> = {},
  items: Item[] = [item()]
) => ({
  created_at,
  item_subtotal: 0,
  discount_subtotal: 0,
  shipping_subtotal: 0,
  tax_total: 0,
  items,
  ...over,
})

const build = (
  orders: ReturnType<typeof order>[],
  refunds: { created_at: string; amount: unknown }[],
  from: string,
  to: string,
  granularity: "day" | "week" | "month" = "day",
  top = 10
) => buildSalesReport({ orders, refunds, from, to, granularity, top })

const ZERO = {
  orders: 0,
  gross_sales: 0,
  discounts: 0,
  net_sales: 0,
  shipping: 0,
  tax: 0,
  revenue: 0,
  refunds: 0,
  net_revenue: 0,
}

const FIELDS = [
  "orders",
  "units",
  "gross_sales",
  "discounts",
  "net_sales",
  "shipping",
  "tax",
  "revenue",
  "refunds",
  "net_revenue",
] as const

describe("buildSalesReport", () => {
  it("day buckets are zero-filled", () => {
    const report = build(
      [order("2026-03-02T10:00:00.000Z", { item_subtotal: 40 })],
      [],
      "2026-03-01",
      "2026-03-03"
    )
    expect(report.trend.map((t) => t.period)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ])
    expect(report.trend[0]).toMatchObject(ZERO)
    expect(report.trend[1]).toMatchObject({
      orders: 1,
      gross_sales: 40,
      net_sales: 40,
      revenue: 40,
      net_revenue: 40,
    })
    expect(report.trend[2]).toMatchObject(ZERO)
    expect(report.currency_code).toBe("usd")
    expect(report.range).toEqual({
      from: "2026-03-01",
      to: "2026-03-03",
      granularity: "day",
    })
  })

  it("weeks start on Monday and are labeled by that Monday", () => {
    const report = build(
      [
        order("2026-01-11T12:00:00.000Z", { item_subtotal: 10 }), // Sunday
        order("2026-01-12T00:00:00.000Z", { item_subtotal: 20 }), // Monday
      ],
      [],
      "2026-01-07",
      "2026-01-20",
      "week"
    )
    expect(report.trend.map((t) => t.period)).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
    ])
    expect(report.trend.map((t) => t.gross_sales)).toEqual([10, 20, 0])
  })

  it("months span year boundaries and partial buckets count only in-range orders", () => {
    const report = build(
      [
        order("2025-12-14T23:59:59.999Z", { item_subtotal: 1000 }), // out
        order("2025-12-15T00:00:00.000Z", { item_subtotal: 1 }),
        order("2026-01-20T00:00:00.000Z", { item_subtotal: 2 }),
        order("2026-02-03T23:59:59.999Z", { item_subtotal: 4 }),
        order("2026-02-04T00:00:00.000Z", { item_subtotal: 1000 }), // out
      ],
      [],
      "2025-12-15",
      "2026-02-03",
      "month"
    )
    expect(report.trend.map((t) => t.period)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ])
    expect(report.trend.map((t) => t.gross_sales)).toEqual([1, 2, 4])
    expect(report.summary.gross_sales).toBe(7)
    expect(report.summary.orders).toBe(3)
  })

  it("boundaries", () => {
    const report = build(
      [
        order("2026-03-01T00:00:00.000Z", { item_subtotal: 1 }),
        order("2026-03-03T23:59:59.999Z", { item_subtotal: 2 }),
        order("2026-03-04T00:00:00.000Z", { item_subtotal: 100 }),
        order("2026-02-28T23:59:59.999Z", { item_subtotal: 100 }),
      ],
      [],
      "2026-03-01",
      "2026-03-03"
    )
    expect(report.summary.orders).toBe(2)
    expect(report.summary.gross_sales).toBe(3)
    expect(report.trend.map((t) => t.gross_sales)).toEqual([1, 0, 2])
  })

  it("cents accumulation", () => {
    const report = build(
      [
        order("2026-03-01T01:00:00.000Z", {
          item_subtotal: 0.1,
          discount_subtotal: 0.1,
          shipping_subtotal: 0.1,
          tax_total: 0.1,
        }),
        order("2026-03-01T02:00:00.000Z", {
          item_subtotal: "0.2",
          discount_subtotal: 0.2,
          shipping_subtotal: 0.2,
          tax_total: 0.2,
        }),
        order("2026-03-01T03:00:00.000Z", {
          item_subtotal: { numeric_: 0.7, valueOf: () => 0.7 },
          discount_subtotal: 0.7,
          shipping_subtotal: 0.7,
          tax_total: 0.7,
        }),
      ],
      [],
      "2026-03-01",
      "2026-03-01"
    )
    expect(report.summary.gross_sales).toBe(1)
    expect(report.summary.discounts).toBe(1)
    expect(report.summary.shipping).toBe(1)
    expect(report.summary.tax).toBe(1)
    expect(report.summary.net_sales).toBe(0)
    expect(report.summary.revenue).toBe(1)
  })

  it("derived figures", () => {
    const base = [
      order("2026-03-01T10:00:00.000Z", {
        item_subtotal: 100,
        discount_subtotal: 10,
        shipping_subtotal: 5,
        tax_total: 8,
      }),
    ]
    const report = build(
      base,
      [{ created_at: "2026-03-01T11:00:00.000Z", amount: 20 }],
      "2026-03-01",
      "2026-03-01"
    )
    expect(report.summary).toMatchObject({
      gross_sales: 100,
      discounts: 10,
      net_sales: 90,
      shipping: 5,
      tax: 8,
      revenue: 95,
      refunds: 20,
      net_revenue: 75,
    })
    const negative = build(
      base,
      [{ created_at: "2026-03-01T11:00:00.000Z", amount: 120 }],
      "2026-03-01",
      "2026-03-01"
    )
    expect(negative.summary.net_revenue).toBe(-25)
    expect(negative.trend[0].net_revenue).toBe(-25)
  })

  it("refunds use the absolute value and their own date", () => {
    const report = build(
      [],
      [
        { created_at: "2026-03-02T09:00:00.000Z", amount: -30 },
        { created_at: "2026-03-09T09:00:00.000Z", amount: -999 }, // out of range
      ],
      "2026-03-01",
      "2026-03-03"
    )
    expect(report.trend.map((t) => t.refunds)).toEqual([0, 30, 0])
    expect(report.trend.map((t) => t.orders)).toEqual([0, 0, 0])
    expect(report.summary.refunds).toBe(30)
    expect(report.summary.net_revenue).toBe(-30)
  })

  it("average_order_value", () => {
    const report = build(
      [
        order("2026-03-01T10:00:00.000Z", {
          item_subtotal: 100,
          discount_subtotal: 10,
          shipping_subtotal: 5,
        }),
        order("2026-03-01T11:00:00.000Z"),
      ],
      [],
      "2026-03-01",
      "2026-03-01"
    )
    expect(report.summary.revenue).toBe(95)
    expect(report.summary.average_order_value).toBe(47.5)
    const empty = build([], [], "2026-03-01", "2026-03-01")
    expect(empty.summary.average_order_value).toBe(0)
    expect(empty.summary).toMatchObject({ ...ZERO, units: 0 })
    expect(empty.top_products).toEqual([])
  })

  it("summary equals the sum of trend", () => {
    const report = build(
      [
        order(
          "2026-03-01T10:00:00.000Z",
          {
            item_subtotal: 33.33,
            discount_subtotal: 3.33,
            shipping_subtotal: 4.99,
            tax_total: 2.17,
          },
          [item({ quantity: 3 })]
        ),
        order(
          "2026-03-03T10:00:00.000Z",
          {
            item_subtotal: 19.97,
            discount_subtotal: 0.07,
            shipping_subtotal: 0.01,
            tax_total: 1.01,
          },
          [item({ quantity: 2 })]
        ),
        order("2026-03-08T10:00:00.000Z", { item_subtotal: 7.77 }),
      ],
      [
        { created_at: "2026-03-03T10:00:00.000Z", amount: -5.55 },
        { created_at: "2026-03-09T10:00:00.000Z", amount: 1.11 },
      ],
      "2026-03-01",
      "2026-03-10",
      "week"
    )
    for (const field of FIELDS) {
      const sum =
        report.trend.reduce(
          (acc, t) => acc + Math.round((t as any)[field] * 100),
          0
        ) / 100
      expect((report.summary as any)[field]).toBe(sum)
    }
    expect(report.summary.units).toBe(6)
  })

  it("units sums item quantities", () => {
    const report = build(
      [
        order("2026-03-01T10:00:00.000Z", {}, [
          item({ quantity: 2 }),
          item({ quantity: "3", variant_id: "var_2" }),
        ]),
        order("2026-03-02T10:00:00.000Z", {}, [item({ quantity: 4 })]),
      ],
      [],
      "2026-03-01",
      "2026-03-02"
    )
    expect(report.summary.units).toBe(9)
    expect(report.trend.map((t) => (t as any).units)).toEqual([5, 4])
  })

  it("top_products groups, orders and limits", () => {
    const orders = [
      order("2026-03-01T10:00:00.000Z", {}, [
        item({ variant_id: "a", title: "Alpha", quantity: 1, subtotal: 50, discount_subtotal: 10 }),
        item({ variant_id: "b", title: "Beta", quantity: 2, subtotal: 40 }),
        item({ variant_id: null, product_id: null, title: "Zed custom", quantity: 1, subtotal: 5 }),
      ]),
      order("2026-03-02T10:00:00.000Z", {}, [
        item({ variant_id: "a", title: "Alpha", quantity: 1, subtotal: 50, discount_subtotal: 10 }),
        item({ variant_id: null, product_id: null, title: "Zed custom", quantity: 2, subtotal: 5 }),
        item({ variant_id: "c", title: "Gamma", quantity: 3, subtotal: 10 }),
        item({ variant_id: "d", title: "Delta", quantity: 3, subtotal: 10 }),
        item({ variant_id: "e", title: "Echo", quantity: 1, subtotal: 10 }),
      ]),
    ]
    const report = build(orders, [], "2026-03-01", "2026-03-02", "day", 10)
    // a: 80, b: 40, c/d: 10 qty 3, e: 10 qty 1, Zed: 10 qty 3
    expect(report.top_products).toEqual([
      { variant_id: "a", product_id: "prod_1", title: "Alpha", quantity: 2, revenue: 80 },
      { variant_id: "b", product_id: "prod_1", title: "Beta", quantity: 2, revenue: 40 },
      { variant_id: "d", product_id: "prod_1", title: "Delta", quantity: 3, revenue: 10 },
      { variant_id: "c", product_id: "prod_1", title: "Gamma", quantity: 3, revenue: 10 },
      { variant_id: null, product_id: null, title: "Zed custom", quantity: 3, revenue: 10 },
      { variant_id: "e", product_id: "prod_1", title: "Echo", quantity: 1, revenue: 10 },
    ])
    expect(
      build(orders, [], "2026-03-01", "2026-03-02", "day", 2).top_products.map(
        (p) => p.title
      )
    ).toEqual(["Alpha", "Beta"])
  })
})

describe("resolveRange", () => {
  const today = new Date("2026-03-31T15:30:00.000Z")

  it("defaults to the 30 days ending today", () => {
    expect(resolveRange({}, today)).toEqual({
      from: "2026-03-02",
      to: "2026-03-31",
    })
  })

  it("fills a missing end", () => {
    expect(resolveRange({ from: "2026-03-10" }, today)).toEqual({
      from: "2026-03-10",
      to: "2026-03-31",
    })
    expect(resolveRange({ to: "2026-03-31" }, today)).toEqual({
      from: "2026-03-02",
      to: "2026-03-31",
    })
  })

  it("rejects inverted ranges", () => {
    expect(() =>
      resolveRange({ from: "2026-03-10", to: "2026-03-09" }, today)
    ).toThrow(/from/i)
  })

  it("caps the range at 366 days after filling", () => {
    expect(
      resolveRange({ from: "2025-03-01", to: "2026-03-01" }, today)
    ).toEqual({ from: "2025-03-01", to: "2026-03-01" }) // 366 days inclusive
    expect(() =>
      resolveRange({ from: "2025-02-28", to: "2026-03-01" }, today)
    ).toThrow(/366/)
    expect(() => resolveRange({ from: "2024-01-01" }, today)).toThrow(/366/)
  })

  it("rejects unparsable dates", () => {
    expect(() => resolveRange({ from: "2026-02-30" }, today)).toThrow()
    expect(() => resolveRange({ to: "nope" }, today)).toThrow()
  })
})
