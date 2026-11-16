import { createMedusaContainer } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  listReceivedVariantLinesStep,
  splitReceivedStockAcrossChannelsStep,
} from "../split-received-stock-across-channels"

const wf = createWorkflow("test-split-received-stock", function (input: any) {
  const r = splitReceivedStockAcrossChannelsStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})
const boom = createStep("boom-after-split", async (_r: any) => {
  throw new Error("boom")
})
const failingWf = createWorkflow("test-split-then-fail", function (input: any) {
  const r = splitReceivedStockAcrossChannelsStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(boom(r))
})
const linesWf = createWorkflow("test-list-received-lines", function (input: any) {
  return new WorkflowResponse(
    listReceivedVariantLinesStep(transform({ input }, ({ input }) => input))
  )
})

function make(opts: {
  channels?: string[] // creation order
  stocks?: Record<string, Record<string, number>> // variant -> channel -> stock
  available?: Record<string, number>
  unmanaged?: string[]
  failSetStocksFor?: string
  items?: { id: string; variant_id: string }[]
}) {
  const channels = opts.channels ?? ["a", "b", "c"]
  const offers: any[] = []
  const addRows = (variant_id: string, byChannel: Record<string, number>) =>
    Object.entries(byChannel).forEach(([sales_channel_id, stock]) =>
      offers.push({
        id: `o_${variant_id}_${sales_channel_id}`,
        variant_id,
        sales_channel_id,
        stock,
        channel_order: channels.indexOf(sales_channel_id) + 1,
        sync_state: "synced",
      })
    )
  Object.entries(opts.stocks ?? {}).forEach(([v, s]) => addRows(v, s))
  const movements: any[] = []
  const service = {
    ensureOffers: jest.fn(async (variantIds: string[], channelIds: string[]) => {
      for (const v of variantIds)
        for (const c of channelIds)
          if (!offers.find((o) => o.variant_id === v && o.sales_channel_id === c))
            addRows(v, { [c]: 0 })
    }),
    listForVariant: jest.fn(async (v: string) =>
      offers
        .filter((o) => o.variant_id === v)
        .sort((x, y) => x.channel_order - y.channel_order)
        .map((o) => ({ ...o }))
    ),
    applyMovement: jest.fn(async (m: any) => {
      if (
        movements.find(
          (x) =>
            x.kind === m.kind &&
            x.ref === m.ref &&
            x.variant_id === m.variant_id &&
            x.sales_channel_id === m.sales_channel_id
        )
      )
        return false
      movements.push({ ...m, id: `m${movements.length}` })
      return true
    }),
    setStocks: jest.fn(async (v: string, s: Record<string, number>) => {
      if (opts.failSetStocksFor === v) throw new Error("db down")
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
    retrievePurchase: jest.fn(async () => ({ id: "p1", items: opts.items ?? [] })),
  }
  const warn = jest.fn()
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  c.register("purchase", { resolve: () => service } as any)
  c.register("locking", {
    resolve: () => ({ execute: async (_k: string[], fn: any) => fn() }),
  } as any)
  c.register("logger", { resolve: () => ({ warn, info: jest.fn() }) } as any)
  c.register("query", {
    resolve: () => ({
      graph: async (q: any) => {
        if (q.entity === "sales_channel")
          return { data: channels.map((id) => ({ id, created_at: id })) }
        const id = q.filters.id
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
  return { c, service, offers, movements, warn }
}

const run = (c: any, lines: { variant_id: string; quantity: number }[], receipt_id = "rec_1") =>
  wf(c).run({ input: { receipt_id, lines } })
const stocksOf = (offers: any[], v = "v1") =>
  Object.fromEntries(offers.filter((o) => o.variant_id === v).map((o) => [o.sales_channel_id, o.stock]))

describe("splitReceivedStockAcrossChannelsStep", () => {
  it("receiving 7 over 3 channels adds 3/2/2 in creation order and records receipt movements", async () => {
    const t = make({ stocks: { v1: { a: 0, b: 0, c: 0 } } })
    const { result } = await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    expect(stocksOf(t.offers)).toEqual({ a: 3, b: 2, c: 2 })
    expect(t.movements.map((m) => [m.kind, m.ref, m.sales_channel_id, m.delta])).toEqual([
      ["receipt", "rec_1", "a", 3],
      ["receipt", "rec_1", "b", 2],
      ["receipt", "rec_1", "c", 2],
    ])
    expect(result.changed).toEqual([
      { variant_id: "v1", sales_channel_id: "a" },
      { variant_id: "v1", sales_channel_id: "b" },
      { variant_id: "v1", sales_channel_id: "c" },
    ])
    expect(t.offers.every((o) => o.sync_state === "pending")).toBe(true)
  })

  it("two receipts accumulate", async () => {
    const t = make({ stocks: { v1: { a: 0, b: 0, c: 0 } } })
    await run(t.c, [{ variant_id: "v1", quantity: 7 }], "rec_1")
    await run(t.c, [{ variant_id: "v1", quantity: 4 }], "rec_2")
    expect(stocksOf(t.offers)).toEqual({ a: 5, b: 3, c: 3 })
  })

  it("is idempotent for the same receipt and variant", async () => {
    const t = make({ stocks: { v1: { a: 0, b: 0, c: 0 } } })
    await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    const { result } = await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    expect(stocksOf(t.offers)).toEqual({ a: 3, b: 2, c: 2 })
    expect(result.changed).toEqual([])
  })

  it("creates missing offer rows for all channels first (ensureOffers)", async () => {
    const t = make({})
    await run(t.c, [{ variant_id: "v1", quantity: 5 }])
    expect(t.service.ensureOffers).toHaveBeenCalledWith(["v1"], ["a", "b", "c"])
    expect(stocksOf(t.offers)).toEqual({ a: 2, b: 2, c: 1 })
  })

  it("sums several lines of the same variant into one split", async () => {
    const t = make({ stocks: { v1: { a: 0, b: 0, c: 0 } } })
    await run(t.c, [
      { variant_id: "v1", quantity: 2 },
      { variant_id: "v1", quantity: 5 },
    ])
    expect(stocksOf(t.offers)).toEqual({ a: 3, b: 2, c: 2 })
  })

  it("skips unmanaged variants without throwing and logs ids only", async () => {
    const t = make({ stocks: { v1: { a: 0, b: 0, c: 0 } }, unmanaged: ["v1"] })
    const { result } = await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    expect(stocksOf(t.offers)).toEqual({ a: 0, b: 0, c: 0 })
    expect(result.changed).toEqual([])
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("v1"))
  })

  it("does nothing and does not throw when there are no channels", async () => {
    const t = make({ channels: [] })
    const { result } = await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    expect(result.changed).toEqual([])
    expect(t.offers).toHaveLength(0)
  })

  it("adds only the free units when channels would exceed available stock", async () => {
    // available 10 already includes the 7 received; channels hold 6 -> 4 free.
    const t = make({ stocks: { v1: { a: 2, b: 2, c: 2 } }, available: { v1: 10 } })
    await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    const s = stocksOf(t.offers)
    expect(s.a + s.b + s.c).toBe(10)
    expect(s).toEqual({ a: 4, b: 3, c: 3 })
    expect(t.warn).toHaveBeenCalled()
  })

  it("adds nothing when there is no free stock", async () => {
    const t = make({ stocks: { v1: { a: 5, b: 5, c: 0 } }, available: { v1: 10 } })
    const { result } = await run(t.c, [{ variant_id: "v1", quantity: 7 }])
    expect(stocksOf(t.offers)).toEqual({ a: 5, b: 5, c: 0 })
    expect(result.changed).toEqual([])
  })

  it("compensation subtracts what was added and removes the movements", async () => {
    const t = make({ stocks: { v1: { a: 1, b: 1, c: 1 } } })
    const r = await failingWf(t.c).run({
        input: { receipt_id: "rec_1", lines: [{ variant_id: "v1", quantity: 7 }] },
        throwOnError: false,
      })
    expect(r.errors[0].error.message).toBe("boom")
    expect(stocksOf(t.offers)).toEqual({ a: 1, b: 1, c: 1 })
    expect(t.movements).toHaveLength(0)
  })

  it("compensation never drives a channel below 0", async () => {
    const t = make({ stocks: { v1: { a: 0, b: 0, c: 0 } } })
    // Stock was sold off after the split but before the compensation ran.
    t.service.listForVariant.mockImplementationOnce(async (v: string) =>
      t.offers.filter((o) => o.variant_id === v).map((o) => ({ ...o }))
    )
    const sellOff = createStep("sell-off", async (_r: any) => {
      for (const o of t.offers) o.stock = 0
      throw new Error("boom")
    })
    const w = createWorkflow("test-split-sell-off", function (input: any) {
      const r = splitReceivedStockAcrossChannelsStep(transform({ input }, ({ input }) => input))
      return new WorkflowResponse(sellOff(r))
    })
    const r = await w(t.c).run({
        input: { receipt_id: "rec_1", lines: [{ variant_id: "v1", quantity: 7 }] },
        throwOnError: false,
      })
    expect(r.errors[0].error.message).toBe("boom")
    expect(stocksOf(t.offers)).toEqual({ a: 0, b: 0, c: 0 })
  })

  it("an unexpected write error undoes this and earlier variants and is rethrown", async () => {
    const t = make({
      stocks: { v1: { a: 0, b: 0, c: 0 }, v2: { a: 0, b: 0, c: 0 } },
      failSetStocksFor: "v2",
    })
    const r = await wf(t.c).run({
        input: {
          receipt_id: "rec_1",
          lines: [
            { variant_id: "v1", quantity: 7 },
            { variant_id: "v2", quantity: 7 },
          ],
        },
        throwOnError: false,
      })
    expect(r.errors[0].error.message).toBe("db down")
    expect(stocksOf(t.offers, "v1")).toEqual({ a: 0, b: 0, c: 0 })
    expect(stocksOf(t.offers, "v2")).toEqual({ a: 0, b: 0, c: 0 })
    expect(t.movements).toHaveLength(0)
  })
})

describe("listReceivedVariantLinesStep", () => {
  it("maps receipt lines to variants through the purchase items, summing per variant", async () => {
    const t = make({
      items: [
        { id: "pi1", variant_id: "v1" },
        { id: "pi2", variant_id: "v1" },
        { id: "pi3", variant_id: "v2" },
      ],
    })
    const { result } = await linesWf(t.c).run({
      input: {
        purchase_id: "p1",
        items: [
          { purchase_item_id: "pi1", quantity: 2 },
          { purchase_item_id: "pi2", quantity: 3 },
          { purchase_item_id: "pi3", quantity: 4 },
        ],
      },
    })
    expect(result).toEqual([
      { variant_id: "v1", quantity: 5 },
      { variant_id: "v2", quantity: 4 },
    ])
  })
})
