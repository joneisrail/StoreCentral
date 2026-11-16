import { createMedusaContainer } from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { validateChannelOfferEditStep } from "../validate-channel-offer-edit"
import { applyChannelOfferEditStep } from "../apply-channel-offer-edit"

const validateWf = createWorkflow("test-validate-channel-offer-edit", function (input: any) {
  const r = validateChannelOfferEditStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})
const applyWf = createWorkflow("test-apply-channel-offer-edit", function (input: any) {
  const r = applyChannelOfferEditStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})

type Offer = { variant_id: string; sales_channel_id: string; stock: number; price: number | null }

function make(opts: {
  levels?: { stocked_quantity: number; reserved_quantity: number }[]
  manage_inventory?: boolean
  variantExists?: boolean
  channels?: string[]
  offers?: Offer[]
}) {
  const offers: any[] = (opts.offers ?? []).map((o, i) => ({
    id: `o${i}`,
    channel_order: i + 1,
    sync_state: "synced",
    ...o,
  }))
  const movements: any[] = []
  const channels = opts.channels ?? ["sc_a", "sc_b"]
  const service = {
    ensureOffers: jest.fn(async (variants: string[], chans: string[]) => {
      for (const v of variants)
        for (const c of chans)
          if (!offers.find((o) => o.variant_id === v && o.sales_channel_id === c))
            offers.push({
              id: `o${offers.length}`,
              variant_id: v,
              sales_channel_id: c,
              stock: 0,
              price: null,
              sync_state: "pending",
              channel_order: offers.length + 1,
            })
    }),
    listForVariant: jest.fn(async (v: string) =>
      offers.filter((o) => o.variant_id === v).map((o) => ({ ...o }))
    ),
    applyMovement: jest.fn(async (m: any) => {
      movements.push(m)
      return true
    }),
    setStocks: jest.fn(async (v: string, s: Record<string, number>) => {
      for (const [c, n] of Object.entries(s))
        offers.find((o) => o.variant_id === v && o.sales_channel_id === c).stock = n
    }),
    setPrice: jest.fn(async (v: string, c: string, p: number | null) => {
      offers.find((o) => o.variant_id === v && o.sales_channel_id === c).price = p
    }),
    markSync: jest.fn(async (v: string, c: string, r: any) => {
      offers.find((o) => o.variant_id === v && o.sales_channel_id === c).sync_state = r.state
    }),
  }
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  c.register("locking", {
    resolve: () => ({ execute: async (_k: string[], fn: any) => fn() }),
  } as any)
  c.register("sales_channel", {
    resolve: () => ({
      retrieveSalesChannel: async (id: string) => {
        if (!channels.includes(id)) {
          const e: any = new Error("Sales channel not found")
          e.type = "not_found"
          throw e
        }
        return { id }
      },
    }),
  } as any)
  c.register("query", {
    resolve: () => ({
      graph: async () => ({
        data:
          opts.variantExists === false
            ? []
            : [
                {
                  id: "variant_1",
                  manage_inventory: opts.manage_inventory ?? true,
                  inventory_items: [
                    {
                      required_quantity: 1,
                      inventory: {
                        location_levels: opts.levels ?? [
                          { stocked_quantity: 10, reserved_quantity: 2 },
                        ],
                      },
                    },
                  ],
                },
              ],
      }),
    }),
  } as any)
  return { c, service, offers, movements }
}

const base = { variant_id: "variant_1", channel_id: "sc_a" }
const stockOf = (offers: any[], ch: string) =>
  offers.find((o) => o.sales_channel_id === ch).stock

describe("validateChannelOfferEditStep", () => {
  it("rejects negative / fractional stock and negative price", async () => {
    for (const body of [{ stock: -1 }, { stock: 1.5 }, { price: -0.01 }]) {
      await expect(
        validateWf(make({}).c).run({ input: { ...base, ...body } })
      ).rejects.toMatchObject({ type: "invalid_data" })
    }
  })

  it("requires at least one of price/stock", async () => {
    await expect(validateWf(make({}).c).run({ input: base })).rejects.toMatchObject({ message: expect.stringMatching(/price or stock/i) })
  })

  it("allows price null and reports the kind", async () => {
    const { result } = await validateWf(make({}).c).run({
      input: { ...base, price: null },
    })
    expect(result).toEqual({ kind: "price" })
    expect(
      (await validateWf(make({}).c).run({ input: { ...base, price: 1, stock: 2 } }))
        .result.kind
    ).toBe("both")
    expect(
      (await validateWf(make({}).c).run({ input: { ...base, stock: 2 } })).result.kind
    ).toBe("stock")
  })

  it("404s unknown channel and unknown variant", async () => {
    await expect(
      validateWf(make({}).c).run({ input: { ...base, channel_id: "nope", price: 1 } })
    ).rejects.toMatchObject({ type: "not_found" })
    await expect(
      validateWf(make({ variantExists: false }).c).run({ input: { ...base, price: 1 } })
    ).rejects.toMatchObject({ type: "not_found" })
  })

  it("rejects stock edits when inventory is not managed, but allows price", async () => {
    await expect(
      validateWf(make({ manage_inventory: false }).c).run({ input: { ...base, stock: 1 } })
    ).rejects.toMatchObject({ message: expect.stringMatching(/manage/i) })
    await expect(
      validateWf(make({ manage_inventory: false }).c).run({ input: { ...base, price: 5 } })
    ).resolves.toBeDefined()
  })
})

describe("applyChannelOfferEditStep", () => {
  const offers: Offer[] = [
    { variant_id: "variant_1", sales_channel_id: "sc_a", stock: 3, price: null },
    { variant_id: "variant_1", sales_channel_id: "sc_b", stock: 4, price: 9 },
  ]
  const fresh = () => offers.map((o) => ({ ...o }))

  it("sets stock, records an edit movement and marks pending", async () => {
    const m = make({ offers: fresh() })
    await applyWf(m.c).run({ input: { ...base, stock: 4 } })
    expect(stockOf(m.offers, "sc_a")).toBe(4)
    expect(m.movements).toEqual([
      expect.objectContaining({
        kind: "edit",
        variant_id: "variant_1",
        sales_channel_id: "sc_a",
        delta: 1,
      }),
    ])
    expect(m.offers.find((o) => o.sales_channel_id === "sc_a").sync_state).toBe("pending")
  })

  it("allows exactly the free units (available 8, other 4 => max 4)", async () => {
    const m = make({ offers: fresh() })
    await expect(applyWf(m.c).run({ input: { ...base, stock: 4 } })).resolves.toBeDefined()
  })

  it("rejects over-allocation and names the free units", async () => {
    const m = make({ offers: fresh() })
    await expect(applyWf(m.c).run({ input: { ...base, stock: 5 } })).rejects.toMatchObject({ message: expect.stringMatching(/only 4 unit/i) })
    expect(stockOf(m.offers, "sc_a")).toBe(3)
    expect(m.movements).toHaveLength(0)
  })

  it("floors available at 0 when reserved exceeds stocked", async () => {
    const m = make({
      levels: [{ stocked_quantity: 1, reserved_quantity: 5 }],
      offers: [{ ...offers[0], stock: 0 }],
    })
    await expect(applyWf(m.c).run({ input: { ...base, stock: 1 } })).rejects.toMatchObject({ message: expect.stringMatching(/only 0 unit/i) })
  })

  it("sets price (including null) without a movement", async () => {
    const m = make({ offers: fresh() })
    await applyWf(m.c).run({ input: { ...base, price: 12.5 } })
    expect(m.offers[0].price).toBe(12.5)
    await applyWf(m.c).run({ input: { ...base, price: null } })
    expect(m.offers[0].price).toBeNull()
    expect(m.movements).toHaveLength(0)
    expect(m.offers[0].sync_state).toBe("pending")
  })

  it("creates a missing offer row via ensureOffers", async () => {
    const m = make({ offers: [] })
    await applyWf(m.c).run({ input: { ...base, stock: 2 } })
    expect(m.service.ensureOffers).toHaveBeenCalledWith(["variant_1"], ["sc_a"])
    expect(stockOf(m.offers, "sc_a")).toBe(2)
  })

  it("reports the real kind of change", async () => {
    const run = async (body: any) => {
      const m = make({ offers: fresh() })
      return (await applyWf(m.c).run({ input: { ...base, ...body } })).result.kind
    }
    expect(await run({ stock: 4 })).toBe("stock")
    expect(await run({ price: 7 })).toBe("price")
    expect(await run({ stock: 4, price: 7 })).toBe("both")
    expect(await run({ stock: 3, price: 7 })).toBe("price")
    expect(await run({ stock: 4, price: null })).toBe("stock")
  })

  it("treats identical stock and price as a no-op", async () => {
    const o = fresh()
    o[0].price = 9.5
    const m = make({ offers: o })
    const { result } = await applyWf(m.c).run({
      input: { ...base, stock: 3, price: 9.5 },
    })
    expect(result.kind).toBeNull()
    expect(m.movements).toHaveLength(0)
    expect(m.service.setStocks).not.toHaveBeenCalled()
    expect(m.service.setPrice).not.toHaveBeenCalled()
    expect(m.service.markSync).not.toHaveBeenCalled()
    expect(m.offers[0].sync_state).toBe("synced")
    const n = make({ offers: fresh() })
    expect((await applyWf(n.c).run({ input: { ...base, price: null } })).result.kind).toBeNull()
  })

  it("uses the variant lock key", async () => {
    const m = make({ offers: fresh() })
    const execute = jest.fn(async (_k: string[], fn: any) => fn())
    m.c.register("locking", { resolve: () => ({ execute }) } as any)
    await applyWf(m.c).run({ input: { ...base, price: 1 } })
    expect(execute.mock.calls[0][0]).toEqual(["channel-offers:variant_1"])
  })
})
