import { createMedusaContainer } from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ensureChannelOffersStep } from "../ensure-channel-offers"
import { trimChannelStockStep } from "../trim-channel-stock"

const trimWf = createWorkflow("test-trim-step", function (input: any) {
  const r = trimChannelStockStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})
const ensureWf = createWorkflow("test-ensure-step", function (input: any) {
  const r = ensureChannelOffersStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})

function make(opts: {
  channels?: string[]
  stocks?: Record<string, number> // channel -> stock for v1
  available?: number
  unmanaged?: boolean
  variantIds?: string[]
}) {
  const channels = opts.channels ?? ["a", "b", "c"]
  const offers: any[] = Object.entries(opts.stocks ?? {}).map(([c, stock]) => ({
    id: `o_${c}`,
    variant_id: "v1",
    sales_channel_id: c,
    stock,
    channel_order: channels.indexOf(c) + 1,
    sync_state: "synced",
  }))
  const movements: any[] = []
  const service = {
    ensureOffers: jest.fn(async () => {}),
    listForVariant: jest.fn(async () =>
      offers.slice().sort((x, y) => x.channel_order - y.channel_order).map((o) => ({ ...o }))
    ),
    applyMovement: jest.fn(async (m: any) => {
      movements.push(m)
      return true
    }),
    setStocks: jest.fn(async (_v: string, s: Record<string, number>) => {
      for (const [c, n] of Object.entries(s)) offers.find((o) => o.sales_channel_id === c).stock = n
    }),
    markSync: jest.fn(async () => {}),
    listChannelStockMovements: jest.fn(async () => []),
    deleteChannelStockMovements: jest.fn(async () => {}),
  }
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  c.register("locking", {
    resolve: () => ({ execute: async (_k: string[], fn: any) => fn() }),
  } as any)
  c.register("logger", { resolve: () => ({ warn: jest.fn(), info: jest.fn() }) } as any)
  c.register("query", {
    resolve: () => ({
      graph: async (q: any) => {
        if (q.entity === "sales_channel")
          return { data: channels.map((id) => ({ id, created_at: id })) }
        if (q.entity === "product_variant" && !q.filters) {
          const all = opts.variantIds ?? []
          return { data: all.slice(q.pagination.skip, q.pagination.skip + q.pagination.take).map((id) => ({ id })) }
        }
        return {
          data: [
            {
              id: "v1",
              manage_inventory: !opts.unmanaged,
              inventory_items: [
                {
                  required_quantity: 1,
                  inventory: {
                    location_levels: [{ stocked_quantity: opts.available ?? 0, reserved_quantity: 0 }],
                  },
                },
              ],
            },
          ],
        }
      },
    }),
  } as any)
  return { c, service, offers, movements }
}

describe("trimChannelStockStep", () => {
  it("trims the largest channel first when the total fell and records trim movements", async () => {
    const t = make({ stocks: { a: 5, b: 2, c: 1 }, available: 5 })
    const { result } = await trimWf(t.c).run({ input: { variant_id: "v1" } })
    expect(Object.fromEntries(t.offers.map((o) => [o.sales_channel_id, o.stock]))).toEqual({
      a: 2,
      b: 2,
      c: 1,
    })
    expect(t.movements.map((m) => [m.kind, m.sales_channel_id, m.delta])).toEqual([
      ["trim", "a", -3],
    ])
    expect(t.movements[0].ref).toMatch(/^trim:/)
    expect(result.changed).toEqual([{ variant_id: "v1", sales_channel_id: "a" }])
  })

  it("is a no-op when the sum is within the total (no loop on our own writes)", async () => {
    const t = make({ stocks: { a: 2, b: 2, c: 1 }, available: 10 })
    const { result } = await trimWf(t.c).run({ input: { variant_id: "v1" } })
    expect(t.service.setStocks).not.toHaveBeenCalled()
    expect(t.movements).toEqual([])
    expect(result.changed).toEqual([])
  })

  it("skips unmanaged variants (no trim, no writes)", async () => {
    const t = make({ stocks: { a: 5, b: 2, c: 1 }, available: 0, unmanaged: true })
    const { result } = await trimWf(t.c).run({ input: { variant_id: "v1" } })
    expect(t.service.setStocks).not.toHaveBeenCalled()
    expect(t.movements).toEqual([])
    expect(result.changed).toEqual([])
    expect(t.offers.map((o) => o.stock)).toEqual([5, 2, 1])
  })

  it("an increase leaves stock unallocated", async () => {
    const t = make({ stocks: { a: 1, b: 1, c: 1 }, available: 100 })
    await trimWf(t.c).run({ input: { variant_id: "v1" } })
    expect(t.offers.map((o) => o.stock)).toEqual([1, 1, 1])
  })
})

describe("ensureChannelOffersStep", () => {
  it("a new variant is ensured across all channels in creation order", async () => {
    const t = make({})
    await ensureWf(t.c).run({ input: { variant_id: "v9" } })
    expect(t.service.ensureOffers).toHaveBeenCalledWith(["v9"], ["a", "b", "c"])
  })

  it("a new channel is ensured for all variants in batches", async () => {
    const variantIds = Array.from({ length: 1100 }, (_, i) => `v${i}`)
    const t = make({ variantIds })
    await ensureWf(t.c).run({ input: { sales_channel_id: "d" } })
    const calls = t.service.ensureOffers.mock.calls as any[]
    expect(calls.map((c) => c[0].length)).toEqual([500, 500, 100])
    expect(calls.every((c) => c[1].length === 1 && c[1][0] === "d")).toBe(true)
  })
})
