import { planInitialSplit, splitVariants } from "../split-existing-stock"

describe("planInitialSplit", () => {
  const ch = ["a", "b", "c"]

  it("splits 7 over three channels, remainder in channel order", () => {
    expect(
      planInitialSplit([{ variant_id: "v1", available: 7, existing: { a: 0, b: 0, c: 0 } }], ch)
    ).toEqual([{ variant_id: "v1", stocks: { a: 3, b: 2, c: 2 } }])
  })

  it("skips a variant with any nonzero existing channel stock", () => {
    expect(
      planInitialSplit([{ variant_id: "v1", available: 7, existing: { a: 0, b: 1, c: 0 } }], ch)
    ).toEqual([])
  })

  it("skips variants with nothing available", () => {
    expect(
      planInitialSplit([{ variant_id: "v1", available: 0, existing: {} }], ch)
    ).toEqual([])
  })

  it("plans nothing without channels", () => {
    expect(planInitialSplit([{ variant_id: "v1", available: 5, existing: {} }], [])).toEqual([])
  })
})

function fakeContainer(initial: Record<string, Record<string, number>>) {
  const stocks = JSON.parse(JSON.stringify(initial)) as Record<string, Record<string, number>>
  const movements: any[] = []
  const events: any[] = []
  const locks: string[] = []
  const offers = {
    ensureOffers: jest.fn(async (variantIds: string[], channelIds: string[]) => {
      for (const v of variantIds) {
        stocks[v] ??= {}
        for (const c of channelIds) stocks[v][c] ??= 0
      }
    }),
    listForVariant: jest.fn(async (v: string) =>
      Object.entries(stocks[v] ?? {}).map(([sales_channel_id, stock]) => ({ sales_channel_id, stock }))
    ),
    listChannelStockMovements: jest.fn(async (f: any) =>
      movements.filter((m) => m.kind === f.kind && m.ref === f.ref && m.variant_id === f.variant_id)
    ),
    setStocks: jest.fn(async (v: string, s: Record<string, number>) => {
      Object.assign(stocks[v], s)
    }),
    applyMovement: jest.fn(async (m: any) => {
      movements.push(m)
      return true
    }),
  }
  const container = {
    resolve: (key: string) => {
      if (key === "channelOffers") return offers
      if (key === "locking")
        return {
          execute: async (keys: string[], fn: () => Promise<any>) => {
            locks.push(...keys)
            return fn()
          },
        }
      if (key === "event_bus")
        return { emit: (e: any) => events.push(e) }
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  return { container: container as any, stocks, movements, events, locks, offers }
}

describe("splitVariants", () => {
  const ch = ["a", "b", "c"]
  const input = [
    { variant_id: "v1", available: 7 },
    { variant_id: "v2", available: 0 },
    { variant_id: "v3", available: 3 },
  ]

  it("ensures rows, writes stock under the lock with rebalance movements, emits no events", async () => {
    const f = fakeContainer({})
    const res = await splitVariants(f.container, input, ch, { dryRun: false })
    expect(res).toEqual({ checked: 3, split: 2, skipped: 1 })
    expect(f.stocks.v1).toEqual({ a: 3, b: 2, c: 2 })
    expect(f.stocks.v3).toEqual({ a: 1, b: 1, c: 1 })
    expect(f.locks).toEqual(["channel-offers:v1", "channel-offers:v2", "channel-offers:v3"])
    expect(f.movements.every((m) => m.kind === "rebalance")).toBe(true)
    expect(f.movements.filter((m) => m.variant_id === "v1").map((m) => [m.sales_channel_id, m.delta, m.ref])).toEqual([
      ["a", 3, "initial-split:v1"],
      ["b", 2, "initial-split:v1"],
      ["c", 2, "initial-split:v1"],
    ])
    expect(f.events).toEqual([])
  })

  it("a second run changes nothing", async () => {
    const f = fakeContainer({})
    await splitVariants(f.container, input, ch, { dryRun: false })
    const snapshot = JSON.stringify(f.stocks)
    const movementCount = f.movements.length
    const res = await splitVariants(f.container, input, ch, { dryRun: false })
    expect(res.split).toBe(0)
    expect(JSON.stringify(f.stocks)).toBe(snapshot)
    expect(f.movements).toHaveLength(movementCount)
  })

  it("does not re-split a variant whose channel stock later became zero", async () => {
    const f = fakeContainer({})
    await splitVariants(f.container, [{ variant_id: "v1", available: 7 }], ch, { dryRun: false })
    f.stocks.v1 = { a: 0, b: 0, c: 0 }
    const res = await splitVariants(f.container, [{ variant_id: "v1", available: 7 }], ch, { dryRun: false })
    expect(res.split).toBe(0)
    expect(f.stocks.v1).toEqual({ a: 0, b: 0, c: 0 })
  })

  it("dry run counts only and writes nothing", async () => {
    const f = fakeContainer({})
    const res = await splitVariants(f.container, input, ch, { dryRun: true })
    expect(res).toEqual({ checked: 3, split: 2, skipped: 1 })
    expect(f.offers.ensureOffers).not.toHaveBeenCalled()
    expect(f.offers.setStocks).not.toHaveBeenCalled()
    expect(f.offers.applyMovement).not.toHaveBeenCalled()
    expect(f.locks).toEqual([])
  })
})
