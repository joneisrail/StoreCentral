import { createMedusaContainer } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { applyOrderToChannelStockStep } from "../apply-order-to-channel-stock"

const wf = createWorkflow("test-apply-order-to-channel-stock", function (input: any) {
  const r = applyOrderToChannelStockStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})

const boom = createStep("boom-after-order-stock", async (_r: any) => {
  throw new Error("boom")
})
const failingWf = createWorkflow("test-apply-order-then-fail", function (input: any) {
  const r = applyOrderToChannelStockStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(boom(r))
})

type Line = { id: string; variant_id: string | null; quantity: number }

function make(opts: {
  order?: { sales_channel_id: string | null; items: Line[] } | null
  // stock per variant per channel, in channel creation order
  stocks?: Record<string, Record<string, number>>
  available?: Record<string, number>
  unmanaged?: string[]
  missingVariants?: string[]
  share?: boolean
  // movements already recorded, e.g. the deduction a cancel must undo
  prior?: { kind: string; ref: string; variant_id: string; sales_channel_id: string; delta: number }[]
}) {
  const offers: any[] = []
  Object.entries(opts.stocks ?? {}).forEach(([variant_id, byChannel]) =>
    Object.entries(byChannel).forEach(([sales_channel_id, stock], i) =>
      offers.push({
        id: `o_${variant_id}_${sales_channel_id}`,
        variant_id,
        sales_channel_id,
        stock,
        channel_order: i + 1,
        sync_state: "synced",
      })
    )
  )
  const movements: any[] = (opts.prior ?? []).map((m, i) => ({ ...m, id: `p${i}` }))
  const service = {
    ensureOffers: jest.fn(),
    listForVariant: jest.fn(async (v: string) =>
      offers.filter((o) => o.variant_id === v).map((o) => ({ ...o }))
    ),
    applyMovement: jest.fn(async (m: any) => {
      const dup = movements.find(
        (x) =>
          x.kind === m.kind &&
          x.ref === m.ref &&
          x.variant_id === m.variant_id &&
          x.sales_channel_id === m.sales_channel_id
      )
      if (dup) return false
      movements.push({ ...m, id: `m${movements.length}` })
      return true
    }),
    setStocks: jest.fn(async (v: string, s: Record<string, number>) => {
      for (const [c, n] of Object.entries(s))
        offers.find((o) => o.variant_id === v && o.sales_channel_id === c).stock = n
    }),
    markSync: jest.fn(async (v: string, c: string, r: any) => {
      offers.find((o) => o.variant_id === v && o.sales_channel_id === c).sync_state = r.state
    }),
    listChannelStockMovements: jest.fn(async (f: any) =>
      movements.filter(
        (m) =>
          m.variant_id === f.variant_id &&
          (f.sales_channel_id === undefined || m.sales_channel_id === f.sales_channel_id) &&
          ([] as string[]).concat(f.ref).includes(m.ref) &&
          ([] as string[]).concat(f.kind).includes(m.kind)
      )
    ),
    deleteChannelStockMovements: jest.fn(async (ids: string[]) => {
      for (const id of ids) movements.splice(movements.findIndex((m) => m.id === id), 1)
    }),
  }
  const warn = jest.fn()
  const info = jest.fn()
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  c.register("locking", {
    resolve: () => ({ execute: async (_k: string[], fn: any) => fn() }),
  } as any)
  c.register("logger", { resolve: () => ({ warn, info }) } as any)
  c.register("query", {
    resolve: () => ({
      graph: async (q: any) => {
        if (q.entity === "order")
          return { data: opts.order === null ? [] : [{ id: "order_1", ...opts.order }] }
        if (q.entity === "store")
          return { data: [{ id: "s", metadata: { share_stock_after_sale: opts.share === true } }] }
        const id = q.filters.id
        if (opts.missingVariants?.includes(id)) return { data: [] }
        return {
          data: [
            {
              id,
              manage_inventory: !opts.unmanaged?.includes(id),
              inventory_items: [
                {
                  required_quantity: 1,
                  inventory: {
                    location_levels: [
                      { stocked_quantity: opts.available?.[id] ?? 1000, reserved_quantity: 0 },
                    ],
                  },
                },
              ],
            },
          ],
        }
      },
    }),
  } as any)
  return { c, service, offers, movements, warn, info }
}

const run = (c: any, mode: "placed" | "canceled" = "placed") =>
  wf(c).run({ input: { order_id: "order_1", mode } })
const stocksOf = (offers: any[], v = "v1") =>
  Object.fromEntries(offers.filter((o) => o.variant_id === v).map((o) => [o.sales_channel_id, o.stock]))

const prior = (ref: string, delta: number, channel = "a", variant = "v1") => ({
  kind: "order",
  ref,
  variant_id: variant,
  sales_channel_id: channel,
  delta,
})

const order = (items: Line[], sales_channel_id: string | null = "a") => ({ sales_channel_id, items })

describe("applyOrderToChannelStockStep", () => {
  it("placed, switch off: deducts only the order's channel and records an order movement", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }], "b"),
      stocks: { v1: { a: 10, b: 10, c: 10 } },
    })
    const { result } = await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 7, c: 10 })
    expect(t.movements).toEqual([
      expect.objectContaining({ kind: "order", ref: "li_1", sales_channel_id: "b", delta: -3 }),
    ])
    expect(result.changed).toEqual([{ variant_id: "v1", sales_channel_id: "b" }])
  })

  it("placed, switch on: re-splits the pool equally in channel creation order", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 2 }], "a"),
      stocks: { v1: { a: 10, b: 10, c: 10 } },
      share: true,
    })
    const { result } = await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 9, c: 9 })
    expect(t.movements.find((m) => m.kind === "order")).toMatchObject({ sales_channel_id: "a", delta: -2 })
    expect(
      t.movements.filter((m) => m.kind === "rebalance").map((m) => [m.sales_channel_id, m.delta])
    ).toEqual([
      ["a", 2],
      ["b", -1],
      ["c", -1],
    ])
    expect(result.changed).toEqual([
      { variant_id: "v1", sales_channel_id: "b" },
      { variant_id: "v1", sales_channel_id: "c" },
    ])
  })

  it("never goes below zero", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 5 }]),
      stocks: { v1: { a: 2, b: 4 } },
    })
    await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 0, b: 4 })
    expect(t.movements[0].delta).toBe(-2)
  })

  it("canceled restores the units to the order's channel", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 5, b: 5 } },
      available: { v1: 100 },
      prior: [prior("li_1", -3)],
    })
    await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 8, b: 5 })
    expect(t.movements.find((m) => m.kind === "cancel")).toMatchObject({ ref: "li_1", delta: 3 })
  })

  it("canceled adds back only the free units when the sum would exceed available stock", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 5 }]),
      stocks: { v1: { a: 5, b: 5 } },
      available: { v1: 12 },
      prior: [prior("li_1", -5)],
    })
    await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 7, b: 5 })
    expect(t.movements.find((m) => m.kind === "cancel").delta).toBe(2)
  })

  it("canceled with nothing free changes nothing but is still recorded as handled", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 5 }]),
      stocks: { v1: { a: 5, b: 5 } },
      available: { v1: 10 },
      prior: [prior("li_1", -5)],
    })
    const { result } = await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 5, b: 5 })
    expect(result.changed).toEqual([])
    expect(t.movements).toHaveLength(2)
  })

  it("canceled with the switch on re-splits after adding back", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 2 }]),
      stocks: { v1: { a: 8, b: 9, c: 9 } },
      available: { v1: 100 },
      share: true,
      prior: [prior("li_1", -2)],
    })
    await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 9, c: 9 })
  })

  it("a second delivery of the same event changes nothing", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 10, b: 10 } },
    })
    await run(t.c)
    const { result } = await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 7, b: 10 })
    expect(t.movements).toHaveLength(1)
    expect(result.changed).toEqual([])
  })

  it("skips an order without a sales channel, logging ids only", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }], null),
      stocks: { v1: { a: 10 } },
    })
    const { result } = await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 10 })
    expect(result.changed).toEqual([])
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("order_1"))
  })

  it("skips lines without variant_id, unmanaged variants, and variants without offer rows (creating none)", async () => {
    const t = make({
      order: order([
        { id: "li_1", variant_id: null, quantity: 1 },
        { id: "li_2", variant_id: "v_unmanaged", quantity: 1 },
        { id: "li_3", variant_id: "v_norows", quantity: 1 },
        { id: "li_4", variant_id: "v1", quantity: 1 },
      ]),
      stocks: { v1: { a: 5 }, v_unmanaged: { a: 5 } },
      unmanaged: ["v_unmanaged"],
    })
    await run(t.c)
    expect(stocksOf(t.offers, "v_unmanaged")).toEqual({ a: 5 })
    expect(stocksOf(t.offers, "v1")).toEqual({ a: 4 })
    expect(t.service.ensureOffers).not.toHaveBeenCalled()
    expect(t.offers.some((o) => o.variant_id === "v_norows")).toBe(false)
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("v_norows"))
    expect(t.movements).toHaveLength(1)
  })

  it("applies several lines of one variant and reports each changed channel once", async () => {
    const t = make({
      order: order([
        { id: "li_1", variant_id: "v1", quantity: 1 },
        { id: "li_2", variant_id: "v1", quantity: 2 },
      ]),
      stocks: { v1: { a: 10, b: 10 } },
    })
    const { result } = await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 7, b: 10 })
    expect(result.changed).toEqual([{ variant_id: "v1", sales_channel_id: "a" }])
  })

  it("cancel with no recorded deduction changes nothing and logs ids only", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 5, b: 5 } },
      available: { v1: 100 },
    })
    const { result } = await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 5, b: 5 })
    expect(result.changed).toEqual([])
    expect(t.movements).toEqual([])
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("li_1"))
  })

  it("a floored deduction is cancelled back for exactly what was deducted", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 5 }]),
      stocks: { v1: { a: 2, b: 4 } },
      available: { v1: 100 },
    })
    await run(t.c)
    expect(stocksOf(t.offers)).toEqual({ a: 0, b: 4 })
    await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 2, b: 4 })
  })

  it("a duplicate cancel delivery changes nothing", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 10, b: 10 } },
      available: { v1: 100 },
    })
    await run(t.c)
    await run(t.c, "canceled")
    const { result } = await run(t.c, "canceled")
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 10 })
    expect(result.changed).toEqual([])
  })

  it("place then cancel the same line with the switch on records both rebalance sets", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 2 }]),
      stocks: { v1: { a: 10, b: 10, c: 10 } },
      available: { v1: 100 },
      share: true,
    })
    await run(t.c)
    await run(t.c, "canceled")
    const rb = t.movements.filter((m) => m.kind === "rebalance")
    expect(rb.filter((m) => m.ref === "placed:li_1").length).toBeGreaterThan(0)
    expect(rb.filter((m) => m.ref === "canceled:li_1").length).toBeGreaterThan(0)
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 10, c: 10 })
  })

  it("a failed cancel rolls back its own rows and leaves the placed rows intact", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 2 }]),
      stocks: { v1: { a: 10, b: 10, c: 10 } },
      available: { v1: 100 },
      share: true,
    })
    await run(t.c)
    const placedMovements = t.movements.map((m) => m.id)
    const stocksAfterPlace = stocksOf(t.offers)
    const orig = t.service.applyMovement.getMockImplementation()!
    t.service.applyMovement.mockImplementation(async (m: any) => {
      if (m.kind === "rebalance" && m.ref === "canceled:li_1") throw new Error("write failed")
      return orig(m)
    })
    const r = await wf(t.c).run({
      input: { order_id: "order_1", mode: "canceled" },
      throwOnError: false,
    })
    expect(r.errors[0].error.message).toBe("write failed")
    expect(stocksOf(t.offers)).toEqual(stocksAfterPlace)
    expect(t.movements.map((m) => m.id)).toEqual(placedMovements)
  })

  it("writes stock before the movement and restores stock if the movement fails", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 10, b: 10 } },
    })
    const calls: string[] = []
    const setOrig = t.service.setStocks.getMockImplementation()!
    t.service.setStocks.mockImplementation(async (v: string, s: any) => {
      calls.push("stock")
      return setOrig(v, s)
    })
    const movOrig = t.service.applyMovement.getMockImplementation()!
    t.service.applyMovement.mockImplementation(async (m: any) => {
      calls.push("movement")
      if (m.kind === "order") throw new Error("movement failed")
      return movOrig(m)
    })
    const r = await wf(t.c).run({
      input: { order_id: "order_1", mode: "placed" },
      throwOnError: false,
    })
    expect(calls.slice(0, 2)).toEqual(["stock", "movement"])
    expect(r.errors[0].error.message).toBe("movement failed")
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 10 })
    expect(t.movements).toEqual([])
  })

  it("a rollback error is logged and the original error is rethrown", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 10, b: 10 } },
    })
    t.service.applyMovement.mockRejectedValue(new Error("original"))
    t.service.setStocks
      .mockImplementationOnce(async () => {})
      .mockRejectedValue(new Error("rollback"))
    const r = await wf(t.c).run({
      input: { order_id: "order_1", mode: "placed" },
      throwOnError: false,
    })
    expect(r.errors[0].error.message).toBe("original")
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("rollback failed"))
  })

  it("logs a skip when the variant is missing", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v_gone", quantity: 1 }]),
      missingVariants: ["v_gone"],
    })
    await run(t.c)
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("v_gone"))
  })

  it("compensation restores stocks and removes movements", async () => {
    const t = make({
      order: order([{ id: "li_1", variant_id: "v1", quantity: 3 }]),
      stocks: { v1: { a: 10, b: 10 } },
      share: true,
    })
    const r = await failingWf(t.c).run({ input: { order_id: "order_1", mode: "placed" }, throwOnError: false })
    expect(r.errors[0].error.message).toBe("boom")
    expect(stocksOf(t.offers)).toEqual({ a: 10, b: 10 })
    expect(t.movements).toEqual([])
  })
})
