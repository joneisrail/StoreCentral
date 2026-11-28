import {
  countProductHits,
  createRecordEventHandler,
} from "../../modules/search-insights/record-event"
import {
  createQueryDeduper,
  createRateLimiter,
} from "../../modules/search-insights/rate-limit"

function makeRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}
const log = { error: jest.fn(), warn: jest.fn() }
const req = (body: unknown, ip = "1.1.1.1") =>
  ({ body, ip, scope: { resolve: () => log } }) as any

const HOUR = 60 * 60_000

describe("POST /store/search/events handler", () => {
  let now = 0
  const make = (
    record = jest.fn().mockResolvedValue(undefined),
    count = jest.fn().mockResolvedValue(7)
  ) => ({
    record,
    count,
    handler: createRecordEventHandler({
      limiter: createRateLimiter({ limit: 30, windowMs: 60_000, now: () => now }),
      dedupe: createQueryDeduper({ windowMs: HOUR, now: () => now }),
      count,
      record,
    }),
  })
  beforeEach(() => {
    now = 0
    log.error.mockClear()
    log.warn.mockClear()
  })

  it("records the normalized query with the server-computed count, ignoring the client's", async () => {
    const { handler, record, count } = make()
    const res = makeRes()
    await handler(req({ query: "  Lattafa ", results: 99999 }), res)
    expect(count).toHaveBeenCalledWith(expect.anything(), "lattafa")
    expect(record).toHaveBeenCalledWith(expect.anything(), { query: "lattafa", results: 7 })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it.each([
    [undefined],
    [{}],
    [{ query: 5, results: 1 }],
    [{ query: "lattafa", results: -1 }],
    [{ query: "lattafa", results: 1.5 }],
    [{ query: "x".repeat(201), results: 1 }],
    [{ query: "ab", results: 1 }],
    [{ query: "!!!", results: 1 }],
  ])("returns ok without recording for %j", async (body) => {
    const { handler, record, count } = make()
    const res = makeRes()
    await handler(req(body), res)
    expect(record).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it("does not record when the count query fails, and logs a warning", async () => {
    const { handler, record } = make(
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockRejectedValue(new Error("meili down"))
    )
    const res = makeRes()
    await handler(req({ query: "lattafa", results: 1 }), res)
    expect(record).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("meili down"))
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it("a failed count does not use up the hour: the next event records", async () => {
    const count = jest
      .fn()
      .mockRejectedValueOnce(new Error("meili down"))
      .mockResolvedValue(3)
    const { handler, record } = make(jest.fn().mockResolvedValue(undefined), count)
    await handler(req({ query: "lattafa", results: 1 }), makeRes())
    await handler(req({ query: "lattafa", results: 1 }), makeRes())
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(expect.anything(), { query: "lattafa", results: 3 })
  })

  it("records the same IP + query once per hour; other IPs and queries still count", async () => {
    const { handler, record } = make()
    await handler(req({ query: "lattafa", results: 1 }), makeRes())
    now = 10_000
    await handler(req({ query: " LATTAFA", results: 1 }), makeRes())
    expect(record).toHaveBeenCalledTimes(1)

    await handler(req({ query: "lattafa", results: 1 }, "2.2.2.2"), makeRes())
    await handler(req({ query: "khamrah", results: 1 }), makeRes())
    expect(record).toHaveBeenCalledTimes(3)

    now = HOUR - 1
    await handler(req({ query: "lattafa", results: 1 }), makeRes())
    expect(record).toHaveBeenCalledTimes(3)
    now = HOUR
    await handler(req({ query: "lattafa", results: 1 }), makeRes())
    expect(record).toHaveBeenCalledTimes(4)
  })

  it("ignores the 31st event from one IP in a minute, but not other IPs", async () => {
    const { handler, record } = make()
    for (let i = 0; i < 31; i++) {
      await handler(req({ query: `query ${i}`, results: 1 }), makeRes())
    }
    expect(record).toHaveBeenCalledTimes(30)
    await handler(req({ query: "lattafa", results: 1 }, "2.2.2.2"), makeRes())
    expect(record).toHaveBeenCalledTimes(31)
    now = 60_000
    await handler(req({ query: "lattafa", results: 1 }), makeRes())
    expect(record).toHaveBeenCalledTimes(32)
  })

  it("still returns ok when recording fails", async () => {
    const { handler } = make(jest.fn().mockRejectedValue(new Error("db down")))
    const res = makeRes()
    await handler(req({ query: "lattafa", results: 1 }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("db down"))
  })
})

describe("createQueryDeduper", () => {
  it("caps its size and still answers correctly after pruning", () => {
    let t = 0
    const dedupe = createQueryDeduper({ windowMs: 100, now: () => t, maxKeys: 2 })
    expect(dedupe.claim("a")).toBe(true)
    expect(dedupe.claim("b")).toBe(true)
    t = 150
    // full: expired a and b are pruned to make room
    expect(dedupe.claim("c")).toBe(true)
    expect(dedupe.claim("a")).toBe(true)
    expect(dedupe.claim("c")).toBe(false)
  })
})

describe("countProductHits", () => {
  const scoped = (search: jest.Mock, salesChannelIds?: string[]) =>
    ({
      scope: { resolve: () => ({ search }) },
      publishable_key_context: salesChannelIds
        ? { key: "pk", sales_channel_ids: salesChannelIds }
        : undefined,
    }) as any

  it("asks for a count only, scoped to published products in the key's sales channels", async () => {
    const search = jest.fn().mockResolvedValue({ hits: [], metadata: { count: 12 } })
    await expect(countProductHits(scoped(search, ["sc_1"]), "lattafa")).resolves.toBe(12)
    expect(search).toHaveBeenCalledWith({
      entity: "product",
      fields: ["id"],
      filters: { q: "lattafa", status: "published", sales_channel_ids: ["sc_1"] },
      pagination: { skip: 0, take: 0 },
      search_options: { match_strategy: "last" },
    })
  })

  it("counts published products when the request has no sales channels", async () => {
    const search = jest.fn().mockResolvedValue({ hits: [], metadata: { count: 0 } })
    await expect(countProductHits(scoped(search), "zzzxqj")).resolves.toBe(0)
    expect(search.mock.calls[0][0].filters).toEqual({ q: "zzzxqj", status: "published" })
  })

  it("throws when the engine gives no count", async () => {
    const search = jest.fn().mockResolvedValue({ hits: [], metadata: { count: null } })
    await expect(countProductHits(scoped(search), "lattafa")).rejects.toThrow()
  })
})
