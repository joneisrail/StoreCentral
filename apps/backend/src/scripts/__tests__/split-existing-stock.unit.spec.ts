import splitExistingStock, { planInitialSplit, splitVariants } from "../split-existing-stock"

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
  const liveFrom = (list: { variant_id: string; available: number }[]) => async (_c: any, id: string) => ({
    managed: true,
    available: list.find((v) => v.variant_id === id)!.available,
  })
  const input = [
    { variant_id: "v1", available: 7 },
    { variant_id: "v2", available: 0 },
    { variant_id: "v3", available: 3 },
  ]

  it("ensures rows, writes stock under the lock with rebalance movements, emits no events", async () => {
    const f = fakeContainer({})
    const res = await splitVariants(f.container, input, ch, { dryRun: false, readStock: liveFrom(input) })
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
    await splitVariants(f.container, input, ch, { dryRun: false, readStock: liveFrom(input) })
    const snapshot = JSON.stringify(f.stocks)
    const movementCount = f.movements.length
    const res = await splitVariants(f.container, input, ch, { dryRun: false, readStock: liveFrom(input) })
    expect(res.split).toBe(0)
    expect(JSON.stringify(f.stocks)).toBe(snapshot)
    expect(f.movements).toHaveLength(movementCount)
  })

  it("does not re-split a variant whose channel stock later became zero", async () => {
    const f = fakeContainer({})
    await splitVariants(f.container, [{ variant_id: "v1", available: 7 }], ch, { dryRun: false, readStock: liveFrom(input) })
    f.stocks.v1 = { a: 0, b: 0, c: 0 }
    const res = await splitVariants(f.container, [{ variant_id: "v1", available: 7 }], ch, { dryRun: false, readStock: liveFrom(input) })
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

describe("splitVariants under the lock", () => {
  const ch = ["a", "b", "c"]
  const one = (available: number) => [{ variant_id: "v1", available }]

  it("splits from the lower live value when stock dropped since the snapshot", async () => {
    const f = fakeContainer({})
    await splitVariants(f.container, one(9), ch, {
      dryRun: false,
      readStock: async () => ({ managed: true, available: 4 }),
    })
    expect(f.stocks.v1).toEqual({ a: 2, b: 1, c: 1 })
  })

  it("skips a variant that became unmanaged and writes nothing", async () => {
    const f = fakeContainer({})
    const res = await splitVariants(f.container, one(9), ch, {
      dryRun: false,
      readStock: async () => ({ managed: false, available: 0 }),
    })
    expect(res.split).toBe(0)
    expect(f.offers.ensureOffers).not.toHaveBeenCalled()
    expect(f.offers.setStocks).not.toHaveBeenCalled()
    expect(f.movements).toEqual([])
  })

  it("1 over 3 channels gives a:1 b:0 c:0 with one movement", async () => {
    const f = fakeContainer({})
    await splitVariants(f.container, one(1), ch, {
      dryRun: false,
      readStock: async () => ({ managed: true, available: 1 }),
    })
    expect(f.stocks.v1).toEqual({ a: 1, b: 0, c: 0 })
    expect(f.movements.map((m) => [m.sales_channel_id, m.delta])).toEqual([["a", 1]])
  })

  it("ensures rows only for variants that are written", async () => {
    const f = fakeContainer({})
    await splitVariants(
      f.container,
      [
        { variant_id: "v1", available: 3 },
        { variant_id: "v2", available: 0 },
      ],
      ch,
      { dryRun: false, readStock: async (_c, id) => ({ managed: true, available: id === "v1" ? 3 : 0 }) }
    )
    expect(f.offers.ensureOffers).toHaveBeenCalledTimes(1)
    expect(f.offers.ensureOffers).toHaveBeenCalledWith(["v1"], ch)
  })

  it("an interruption between stock and movements is skipped on rerun", async () => {
    const f = fakeContainer({})
    const live = async () => ({ managed: true, available: 7 })
    f.offers.applyMovement.mockRejectedValueOnce(new Error("boom"))
    await expect(
      splitVariants(f.container, one(7), ch, { dryRun: false, readStock: live })
    ).rejects.toThrow("boom")
    expect(f.stocks.v1).toEqual({ a: 3, b: 2, c: 2 })
    const res = await splitVariants(f.container, one(7), ch, { dryRun: false, readStock: live })
    expect(res.split).toBe(0)
    expect(f.stocks.v1).toEqual({ a: 3, b: 2, c: 2 })
  })
})

describe("default export", () => {
  function scriptContainer() {
    const f = fakeContainer({})
    const logs: string[] = []
    const query = {
      graph: async ({ entity }: any) => {
        if (entity === "sales_channel") {
          return { data: ["a", "b"].map((id, i) => ({ id, created_at: new Date(2020, 0, i + 1) })) }
        }
        return {
          data: [
            {
              id: "v1",
              manage_inventory: true,
              inventory_items: [
                {
                  required_quantity: 1,
                  inventory: { location_levels: [{ stocked_quantity: 5, reserved_quantity: 0 }] },
                },
              ],
            },
          ],
        }
      },
    }
    const pg = { raw: async () => ({ rows: [{ variant_id: "v1", required_quantity: 1, net: 5 }] }) }
    const container = {
      resolve: (key: string) => {
        if (key === "logger") return { info: (m: string) => logs.push(m) }
        if (key === "query") return query
        if (key === "__pg_connection__") return pg
        return f.container.resolve(key)
      },
    }
    return { f, container: container as any, logs }
  }

  it.each([[[]], [["--dry-run"]], [["dry-run"]], [["Apply"]]])("writes nothing with args %j", async (args) => {
    const { f, container, logs } = scriptContainer()
    await splitExistingStock({ container, args } as any)
    expect(f.offers.ensureOffers).not.toHaveBeenCalled()
    expect(f.offers.setStocks).not.toHaveBeenCalled()
    expect(f.offers.applyMovement).not.toHaveBeenCalled()
    expect(logs.join(" | ")).toContain("would split 1")
    expect(logs.join(" | ")).toContain("split-existing-stock.ts apply")
  })

  it("writes only with the exact word apply", async () => {
    const { f, container } = scriptContainer()
    await splitExistingStock({ container, args: ["apply"] } as any)
    expect(f.stocks.v1).toEqual({ a: 3, b: 2 })
    expect(f.events).toEqual([])
  })
})
