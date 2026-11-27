import { createRecordEventHandler } from "../../modules/search-insights/record-event"
import { createRateLimiter } from "../../modules/search-insights/rate-limit"

function makeRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}
const req = (body: unknown, ip = "1.1.1.1") =>
  ({ body, ip, scope: { resolve: () => ({ error: jest.fn() }) } }) as any

describe("POST /store/search/events handler", () => {
  let now = 0
  const make = (record = jest.fn().mockResolvedValue(undefined)) => ({
    record,
    handler: createRecordEventHandler({
      limiter: createRateLimiter({ limit: 30, windowMs: 60_000, now: () => now }),
      record,
    }),
  })
  beforeEach(() => {
    now = 0
  })

  it("records a valid event with the normalized query", async () => {
    const { handler, record } = make()
    const res = makeRes()
    await handler(req({ query: "  Lattafa ", results: 4 }), res)
    expect(record).toHaveBeenCalledWith(expect.anything(), { query: "lattafa", results: 4 })
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
    const { handler, record } = make()
    const res = makeRes()
    await handler(req(body), res)
    expect(record).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it("ignores the 31st event from one IP in a minute, but not other IPs", async () => {
    const { handler, record } = make()
    for (let i = 0; i < 31; i++) {
      await handler(req({ query: "lattafa", results: 1 }), makeRes())
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
  })
})
