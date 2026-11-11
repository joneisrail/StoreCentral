import {
  CostPurchase,
  averageUnitCostCents,
  buildCostEvents,
  buildProfitReport,
} from "../profit"
import { buildSalesReport } from "../sales"

type Line = {
  variant_id: string | null
  product_id: string | null
  title: string
  quantity: unknown
  subtotal: unknown
  discount_subtotal: unknown
}

const line = (over: Partial<Line> = {}): Line => ({
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
  items: Line[] = [line()],
  over: Record<string, unknown> = {}
) => ({
  created_at,
  item_subtotal: items.reduce(
    (s, i) => s + Math.round(Number(i.subtotal) * 100),
    0
  ) / 100,
  discount_subtotal: 0,
  shipping_subtotal: 0,
  tax_total: 0,
  items,
  ...over,
})

// One purchase, one line, fully received at `at`.
const purchase = (
  variant: string | null,
  quantity: number,
  unit_cost: number,
  at: string,
  extras: { shipping_cost?: number; tax?: number; other_cost?: number } = {},
  id = "p"
): CostPurchase => ({
  shipping_cost: 0,
  tax: 0,
  other_cost: 0,
  ...extras,
  items: [{ id: `${id}_i`, variant_id: variant, quantity, unit_cost }],
  receipts: [
    {
      id: `${id}_r`,
      received_at: at,
      items: [{ purchase_item_id: `${id}_i`, quantity }],
    },
  ],
})

type Exp = { expense_date: string | Date; category: string; amount: unknown }
const exp = (expense_date: string | Date, amount: unknown, category = "rent"): Exp => ({
  expense_date,
  category,
  amount,
})

const run = (
  orders: ReturnType<typeof order>[],
  purchases: CostPurchase[],
  opts: {
    refunds?: { created_at: string; amount: unknown }[]
    from?: string
    to?: string
    granularity?: "day" | "week" | "month"
    top?: number
    expenses?: Exp[]
  } = {}
) =>
  buildProfitReport({
    orders,
    refunds: opts.refunds ?? [],
    purchases,
    expenses: opts.expenses ?? [],
    from: opts.from ?? "2026-03-01",
    to: opts.to ?? "2026-03-31",
    granularity: opts.granularity ?? "day",
    top: opts.top ?? 10,
  })

describe("landed cost", () => {
  it("landed cost spreads extras by line value", () => {
    const events = buildCostEvents([
      {
        shipping_cost: 5,
        tax: 3,
        other_cost: 2,
        items: [
          { id: "a", variant_id: "v1", quantity: 2, unit_cost: 10 },
          { id: "b", variant_id: "v2", quantity: 1, unit_cost: 30 },
        ],
        receipts: [
          {
            id: "r",
            received_at: "2026-03-01T00:00:00Z",
            items: [
              { purchase_item_id: "a", quantity: 2 },
              { purchase_item_id: "b", quantity: 1 },
            ],
          },
        ],
      },
    ])
    const at = Date.parse("2026-03-02T00:00:00Z")
    expect(averageUnitCostCents(events.get("v1"), at)).toBe(1200)
    expect(averageUnitCostCents(events.get("v2"), at)).toBe(3600)
  })

  it("landed cost with a zero subtotal spreads extras per unit", () => {
    const events = buildCostEvents([
      purchase("v1", 4, 0, "2026-03-01T00:00:00Z", { shipping_cost: 8 }),
    ])
    expect(
      averageUnitCostCents(events.get("v1"), Date.parse("2026-03-02"))
    ).toBe(200)
  })

  it("landed cost with no extras and no quantity falls back to unit cost", () => {
    const events = buildCostEvents([
      {
        shipping_cost: 5,
        tax: 0,
        other_cost: 0,
        items: [{ id: "a", variant_id: "v1", quantity: 0, unit_cost: 7 }],
        receipts: [
          {
            id: "r",
            received_at: "2026-03-01T00:00:00Z",
            items: [{ purchase_item_id: "a", quantity: 3 }],
          },
        ],
      },
    ])
    expect(
      averageUnitCostCents(events.get("v1"), Date.parse("2026-03-02"))
    ).toBe(700)
    const plain = buildCostEvents([
      purchase("v1", 2, 7.5, "2026-03-01T00:00:00Z"),
    ])
    expect(
      averageUnitCostCents(plain.get("v1"), Date.parse("2026-03-02"))
    ).toBe(750)
  })

  it("ignores unknown purchase lines and variant-less lines", () => {
    const events = buildCostEvents([
      {
        shipping_cost: 0,
        tax: 0,
        other_cost: 0,
        items: [{ id: "a", variant_id: null, quantity: 1, unit_cost: 5 }],
        receipts: [
          {
            id: "r",
            received_at: "2026-03-01T00:00:00Z",
            items: [
              { purchase_item_id: "a", quantity: 1 },
              { purchase_item_id: "zzz", quantity: 1 },
            ],
          },
        ],
      },
    ])
    expect(events.size).toBe(0)
  })
})

describe("average cost", () => {
  it("average cost across two purchases of one variant", () => {
    const events = buildCostEvents([
      purchase("v1", 10, 2, "2026-03-01T00:00:00Z", {}, "p1"),
      purchase("v1", 30, 4, "2026-03-02T00:00:00Z", {}, "p2"),
    ])
    expect(
      averageUnitCostCents(events.get("v1"), Date.parse("2026-03-05"))
    ).toBe(350)
  })

  it("average uses only receipts at or before the sale time", () => {
    const at = Date.parse("2026-03-02T12:00:00Z")
    const mk = (offset: number) =>
      buildCostEvents([
        purchase("v1", 10, 2, "2026-03-01T00:00:00Z", {}, "p1"),
        purchase("v1", 10, 4, new Date(at + offset).toISOString(), {}, "p2"),
      ]).get("v1")
    expect(averageUnitCostCents(mk(0), at)).toBe(300)
    expect(averageUnitCostCents(mk(1), at)).toBe(200)
  })

  it("is null for unknown variants and before the first receipt", () => {
    expect(averageUnitCostCents(undefined, 0)).toBeNull()
    const events = buildCostEvents([
      purchase("v1", 1, 2, "2026-03-05T00:00:00Z"),
    ])
    expect(
      averageUnitCostCents(events.get("v1"), Date.parse("2026-03-04"))
    ).toBeNull()
  })
})

describe("buildProfitReport", () => {
  it("a later higher-priced purchase does not change an earlier sale's cost", () => {
    const orders = [order("2026-03-10T10:00:00Z", [line({ quantity: 2 })])]
    const before = run(orders, [
      purchase("var_1", 10, 3, "2026-03-01T00:00:00Z", {}, "p1"),
    ])
    const after = run(orders, [
      purchase("var_1", 10, 3, "2026-03-01T00:00:00Z", {}, "p1"),
      purchase("var_1", 10, 50, "2026-03-20T00:00:00Z", {}, "p2"),
    ])
    expect(before.summary.cogs).toBe(6)
    expect(after.summary.cogs).toBe(6)
    expect(after.summary.gross_profit).toBe(before.summary.gross_profit)
  })

  it("a sale before the first receipt is uncosted", () => {
    const report = run(
      [
        order("2026-03-10T10:00:00Z", [
          line({ quantity: 3, subtotal: 30 }),
          line({ variant_id: null, title: "Custom", quantity: 2, subtotal: 8 }),
        ]),
      ],
      [purchase("var_1", 10, 3, "2026-03-11T00:00:00Z")]
    )
    expect(report.summary.cogs).toBe(0)
    expect(report.summary.units_without_cost).toBe(5)
    expect(report.summary.net_revenue).toBe(38)
    expect(report.summary.gross_profit).toBe(38)
  })

  it("line cost rounds once per line", () => {
    // 3 units at an average of 33.333... cents -> 100 cents
    const purchases = [purchase("var_1", 3, 1 / 3, "2026-03-01T00:00:00Z")]
    const report = run(
      [order("2026-03-10T00:00:00Z", [line({ quantity: 3, subtotal: 9 })])],
      purchases
    )
    expect(report.summary.cogs).toBe(1)
  })

  it("0.1 + 0.2 style sums give exact cents", () => {
    const report = run(
      [
        order("2026-03-10T00:00:00Z", [line({ quantity: 1, subtotal: 0.7 })]),
        order("2026-03-10T01:00:00Z", [line({ quantity: 1, subtotal: 0.1 })]),
        order("2026-03-10T02:00:00Z", [line({ quantity: 1, subtotal: 0.2 })]),
      ],
      [purchase("var_1", 10, 0.1, "2026-03-01T00:00:00Z")]
    )
    expect(report.summary.net_revenue).toBe(1)
    expect(report.summary.cogs).toBe(0.3)
    expect(report.summary.gross_profit).toBe(0.7)
  })

  it("net revenue matches buildSalesReport", () => {
    const orders = [
      order("2026-03-02T10:00:00Z", [line({ subtotal: 12.34 })], {
        shipping_subtotal: 4.99,
      }),
      order("2026-03-09T10:00:00Z", [line({ subtotal: 20 })], {
        discount_subtotal: 2,
      }),
      order("2026-03-09T11:00:00Z", [line({ subtotal: 0.1 })]),
    ]
    const refunds = [{ created_at: "2026-03-09T12:00:00Z", amount: 3.25 }]
    for (const granularity of ["day", "week", "month"] as const) {
      const profit = run(orders, [], { refunds, granularity })
      const sales = buildSalesReport({
        orders,
        refunds,
        from: "2026-03-01",
        to: "2026-03-31",
        granularity,
        top: 1,
      })
      expect(profit.summary.net_revenue).toBe(sales.summary.net_revenue)
      expect(profit.summary.orders).toBe(sales.summary.orders)
      expect(profit.summary.units).toBe(sales.summary.units)
      expect(profit.trend.map((r) => [r.period, r.net_revenue, r.orders, r.units])).toEqual(
        sales.trend.map((r) => [r.period, r.net_revenue, r.orders, r.units])
      )
    }
  })

  it("gross profit may be negative", () => {
    const report = run(
      [order("2026-03-10T00:00:00Z", [line({ subtotal: 5 })])],
      [purchase("var_1", 1, 8, "2026-03-01T00:00:00Z")]
    )
    expect(report.summary.gross_profit).toBe(-3)
    expect(report.summary.margin_pct).toBe(-60)
  })

  it("margin_pct is null when net revenue is zero or negative", () => {
    const orders = [order("2026-03-10T00:00:00Z", [line({ subtotal: 5 })])]
    const purchases = [purchase("var_1", 1, 2, "2026-03-01T00:00:00Z")]
    const zero = run(orders, purchases, {
      refunds: [{ created_at: "2026-03-10T05:00:00Z", amount: 5 }],
    })
    expect(zero.summary.net_revenue).toBe(0)
    expect(zero.summary.margin_pct).toBeNull()
    const neg = run(orders, purchases, {
      refunds: [{ created_at: "2026-03-10T05:00:00Z", amount: 9 }],
    })
    expect(neg.summary.net_revenue).toBe(-4)
    expect(neg.summary.margin_pct).toBeNull()
    expect(run([], []).summary.margin_pct).toBeNull()
  })

  it("margin_pct is one decimal and the summary comes from summed cents", () => {
    const purchases = [purchase("var_1", 100, 1, "2026-03-01T00:00:00Z")]
    // day 1: revenue 3, cost 1 -> 66.7%; day 2: revenue 100, cost 1 -> 99%
    const report = run(
      [
        order("2026-03-02T10:00:00Z", [line({ quantity: 1, subtotal: 3 })]),
        order("2026-03-03T10:00:00Z", [line({ quantity: 1, subtotal: 100 })]),
      ],
      purchases
    )
    const days = report.trend.filter((r) => r.orders > 0)
    expect(days.map((d) => d.margin_pct)).toEqual([66.7, 99])
    expect(report.summary.margin_pct).toBe(98.1) // 101 / 103, not (66.7+99)/2
  })

  it("summary equals the sum of the trend", () => {
    const report = run(
      [
        order("2026-03-02T10:00:00Z", [line({ quantity: 2, subtotal: 20 })]),
        order("2026-03-02T11:00:00Z", [
          line({ variant_id: "other", quantity: 1, subtotal: 7.77 }),
        ]),
        order("2026-03-15T10:00:00Z", [line({ quantity: 3, subtotal: 31.1 })]),
      ],
      [purchase("var_1", 10, 1.15, "2026-03-01T00:00:00Z")],
      { refunds: [{ created_at: "2026-03-15T12:00:00Z", amount: 1.1 }] }
    )
    const sum = (key: keyof (typeof report.trend)[number]) =>
      Math.round(
        report.trend.reduce((s, r) => s + (r[key] as number), 0) * 100
      ) / 100
    for (const key of [
      "orders",
      "units",
      "net_revenue",
      "cogs",
      "gross_profit",
      "units_without_cost",
    ] as const) {
      expect(report.summary[key]).toBe(sum(key))
    }
    expect(report.summary.units_without_cost).toBe(1)
  })

  it("by_product groups, orders and limits", () => {
    const orders = [
      order("2026-03-02T10:00:00Z", [
        line({ variant_id: "a", title: "A", quantity: 2, subtotal: 30, discount_subtotal: 5 }),
        line({ variant_id: "b", title: "B", quantity: 5, subtotal: 25 }),
        line({ variant_id: null, product_id: null, title: "Zed", quantity: 1, subtotal: 25 }),
        line({ variant_id: null, product_id: null, title: "Alpha", quantity: 1, subtotal: 25 }),
      ]),
      order("2026-03-03T10:00:00Z", [
        line({ variant_id: "a", title: "A", quantity: 1, subtotal: 10 }),
      ]),
    ]
    const purchases = [
      purchase("a", 10, 2, "2026-03-01T00:00:00Z", {}, "pa"),
      purchase("b", 10, 1, "2026-03-01T00:00:00Z", {}, "pb"),
    ]
    const report = run(orders, purchases)
    const a = report.by_product.find((p) => p.variant_id === "a")!
    expect(a).toMatchObject({
      units: 3,
      revenue: 35,
      cogs: 6,
      gross_profit: 29,
      margin_pct: 82.9,
      units_without_cost: 0,
    })
    // profits: a 29, b 20, Alpha 25 (uncosted), Zed 25 (uncosted)
    expect(report.by_product.map((p) => p.title)).toEqual([
      "A",
      "Alpha",
      "Zed",
      "B",
    ])
    const alpha = report.by_product.find((p) => p.title === "Alpha")!
    expect(alpha).toMatchObject({
      revenue: 25,
      cogs: 0,
      units_without_cost: 1,
      variant_id: null,
    })
    expect(run(orders, purchases, { top: 2 }).by_product).toHaveLength(2)
  })

  it("by_product breaks profit ties by units descending", () => {
    const report = run(
      [
        order("2026-03-02T10:00:00Z", [
          line({ variant_id: "a", title: "A", quantity: 1, subtotal: 10 }),
          line({ variant_id: "b", title: "B", quantity: 2, subtotal: 10 }),
        ]),
      ],
      []
    )
    expect(report.by_product.map((p) => p.title)).toEqual(["B", "A"])
  })

  it("weeks and months bucket cost with the Sales rules", () => {
    // 2026-03-01 is a Sunday: it belongs to the week labeled Monday 2026-02-23.
    const orders = [order("2026-03-01T10:00:00Z", [line({ subtotal: 10 })])]
    const purchases = [purchase("var_1", 5, 4, "2026-02-01T00:00:00Z")]
    const week = run(orders, purchases, {
      from: "2026-02-23",
      to: "2026-03-08",
      granularity: "week",
    })
    expect(week.trend.map((r) => [r.period, r.cogs])).toEqual([
      ["2026-02-23", 4],
      ["2026-03-02", 0],
    ])
    const month = run(orders, purchases, {
      from: "2026-02-01",
      to: "2026-03-31",
      granularity: "month",
    })
    expect(month.trend.map((r) => [r.period, r.cogs])).toEqual([
      ["2026-02", 0],
      ["2026-03", 4],
    ])
  })

  it("ignores orders outside the range", () => {
    const report = run(
      [order("2026-04-02T10:00:00Z")],
      [purchase("var_1", 1, 1, "2026-03-01T00:00:00Z")]
    )
    expect(report.summary.cogs).toBe(0)
    expect(report.by_product).toEqual([])
  })
})

describe("buildProfitReport net profit", () => {
  const sale = (at: string, subtotal: number) =>
    order(at, [line({ quantity: 1, subtotal })])
  const stock = [purchase("var_1", 100, 1, "2026-03-01T00:00:00Z")]

  it("sums expenses into day, week and month buckets", () => {
    const expenses = [
      exp("2026-03-02", 10),
      exp("2026-03-02T20:00:00Z", 5),
      exp("2026-03-04", 7),
    ]
    const day = run([], [], { expenses })
    expect(
      day.trend.filter((r) => r.expenses > 0).map((r) => [r.period, r.expenses])
    ).toEqual([
      ["2026-03-02", 15],
      ["2026-03-04", 7],
    ])
    const week = run([], [], { expenses, granularity: "week" })
    expect(week.trend.find((r) => r.period === "2026-03-02")?.expenses).toBe(22)
    const month = run([], [], { expenses, granularity: "month" })
    expect(month.trend.map((r) => [r.period, r.expenses])).toEqual([
      ["2026-03", 22],
    ])
  })

  it("net_profit is gross_profit minus expenses and may be negative", () => {
    const report = run([sale("2026-03-10T10:00:00Z", 10)], stock, {
      expenses: [exp("2026-03-10", 25)],
    })
    expect(report.summary.gross_profit).toBe(9)
    expect(report.summary.expenses).toBe(25)
    expect(report.summary.net_profit).toBe(-16)
    expect(report.summary.net_margin_pct).toBe(-160)
  })

  it("net_margin_pct is null when net revenue is zero or negative", () => {
    const orders = [sale("2026-03-10T10:00:00Z", 5)]
    const expenses = [exp("2026-03-10", 3)]
    const zero = run(orders, stock, {
      expenses,
      refunds: [{ created_at: "2026-03-10T05:00:00Z", amount: 5 }],
    })
    expect(zero.summary.net_margin_pct).toBeNull()
    const neg = run(orders, stock, {
      expenses,
      refunds: [{ created_at: "2026-03-10T05:00:00Z", amount: 9 }],
    })
    expect(neg.summary.net_margin_pct).toBeNull()
    expect(run([], [], { expenses }).summary.net_margin_pct).toBeNull()
  })

  it("includes from and to days and excludes the day after and 1 ms before", () => {
    const report = run([], [], {
      from: "2026-03-10",
      to: "2026-03-12",
      expenses: [
        exp("2026-03-10T00:00:00.000Z", 1),
        exp("2026-03-12T00:00:00.000Z", 2),
        exp("2026-03-13T00:00:00.000Z", 4),
        exp("2026-03-09T23:59:59.999Z", 8),
        exp(new Date("2026-03-11T12:00:00Z"), 16),
      ],
    })
    expect(report.summary.expenses).toBe(19)
    expect(report.expenses_by_category).toEqual([{ category: "rent", amount: 19 }])
    expect(report.trend.map((r) => [r.period, r.expenses])).toEqual([
      ["2026-03-10", 1],
      ["2026-03-11", 16],
      ["2026-03-12", 2],
    ])
  })

  it("0.1 + 0.2 + 0.7 expense sums give exactly 1", () => {
    const report = run([], [], {
      expenses: [
        exp("2026-03-05", 0.1),
        exp("2026-03-05", 0.2),
        exp("2026-03-05", "0.7"),
      ],
    })
    expect(report.summary.expenses).toBe(1)
    expect(report.trend.find((r) => r.period === "2026-03-05")?.expenses).toBe(1)
  })

  it("summary equals the sum of the trend for expenses and net_profit", () => {
    const report = run(
      [
        sale("2026-03-02T10:00:00Z", 20.1),
        sale("2026-03-15T10:00:00Z", 31.1),
      ],
      stock,
      { expenses: [exp("2026-03-02", 0.1), exp("2026-03-15", 0.2), exp("2026-03-20", 0.7)] }
    )
    const sum = (key: "expenses" | "net_profit") =>
      Math.round(report.trend.reduce((s, r) => s + r[key], 0) * 100) / 100
    expect(report.summary.expenses).toBe(sum("expenses"))
    expect(report.summary.net_profit).toBe(sum("net_profit"))
    expect(report.summary.expenses).toBe(1)
  })

  it("summary net margin comes from summed cents, not the mean of buckets", () => {
    const report = run(
      [sale("2026-03-02T10:00:00Z", 3), sale("2026-03-03T10:00:00Z", 100)],
      stock,
      { expenses: [exp("2026-03-03", 50)] }
    )
    const days = report.trend.filter((r) => r.orders > 0)
    expect(days.map((d) => d.net_margin_pct)).toEqual([66.7, 49])
    expect(report.summary.net_margin_pct).toBe(49.5) // 51 / 103
  })

  it("expenses_by_category totals, omits empty, orders by amount then name", () => {
    const report = run([], [], {
      expenses: [
        exp("2026-03-02", 10, "software"),
        exp("2026-03-03", 5, "rent"),
        exp("2026-03-04", 5, "fees"),
        exp("2026-03-05", 20, "marketing"),
        exp("2026-03-06", 10, "software"),
        exp("2026-04-06", 99, "payroll"),
      ],
    })
    expect(report.expenses_by_category).toEqual([
      { category: "marketing", amount: 20 },
      { category: "software", amount: 20 },
      { category: "fees", amount: 5 },
      { category: "rent", amount: 5 },
    ])
    expect(report.expenses_by_category.map((c) => c.category)).toEqual([
      "marketing",
      "software",
      "fees",
      "rent",
    ])
  })

  it("no expenses: zero expenses, net equals gross, empty category list", () => {
    const report = run([sale("2026-03-10T10:00:00Z", 10)], stock)
    expect(report.summary.expenses).toBe(0)
    expect(report.summary.net_profit).toBe(report.summary.gross_profit)
    expect(report.summary.net_margin_pct).toBe(report.summary.margin_pct)
    expect(report.expenses_by_category).toEqual([])
  })
})
