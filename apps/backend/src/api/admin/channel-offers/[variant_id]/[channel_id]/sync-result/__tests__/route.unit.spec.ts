const mockLoadPushValues = jest.fn()
const mockFetchConnected = jest.fn()
jest.mock("../../../../query", () => ({
  loadPushValues: (...a: unknown[]) => mockLoadPushValues(...a),
}))
jest.mock("../../../../connections", () => ({
  fetchConnectedChannelIds: (...a: unknown[]) => mockFetchConnected(...a),
}))

import { POST } from "../route"

function make(row: Record<string, unknown> | null, body: Record<string, unknown>) {
  const query = { graph: jest.fn() }
  const offers = {
    listChannelOffers: jest.fn(async () => (row ? [row] : [])),
    markSync: jest.fn(async (..._a: any[]) => undefined),
  }
  const req = {
    params: { variant_id: "v1", channel_id: "sc_a" },
    validatedBody: body,
    scope: { resolve: (k: string) => (k === "query" ? query : offers) },
  } as any
  const res = { json: jest.fn() } as any
  return { req, res, offers, query }
}

beforeEach(() => jest.resetAllMocks())

describe("POST sync-result", () => {
  it("computes the channel's effective price for a null-price offer and passes it to markSync", async () => {
    mockLoadPushValues.mockResolvedValue({ price: null, effective_price: 12, stock: 5 })
    const t = make({ id: "o1", price: null }, { state: "synced", stock: 5 })
    await POST(t.req, t.res)
    expect(mockLoadPushValues).toHaveBeenCalledWith(
      { query: t.query, offers: t.offers, connectedChannelIds: expect.any(Function) },
      "v1",
      "sc_a"
    )
    await mockLoadPushValues.mock.calls[0][0].connectedChannelIds()
    expect(mockFetchConnected).toHaveBeenCalled()
    expect(t.offers.markSync).toHaveBeenCalledWith("v1", "sc_a", {
      state: "synced",
      error: undefined,
      price: undefined,
      stock: 5,
      effectivePrice: 12,
    })
    expect(t.res.json).toHaveBeenCalledWith({ ok: true })
  })

  it("falls back to the old behaviour when the effective price cannot be computed", async () => {
    mockLoadPushValues.mockRejectedValue(new Error("hub down"))
    const t = make({ id: "o1", price: null }, { state: "synced", stock: 5 })
    await POST(t.req, t.res)
    expect(t.offers.markSync).toHaveBeenCalledWith("v1", "sc_a", {
      state: "synced",
      error: undefined,
      price: undefined,
      stock: 5,
      effectivePrice: undefined,
    })
    expect(t.res.json).toHaveBeenCalledWith({ ok: true })
  })

  it("does not compute it for explicit-price offers or failed reports", async () => {
    const a = make({ id: "o1", price: "15" }, { state: "synced", stock: 5 })
    await POST(a.req, a.res)
    const b = make({ id: "o1", price: null }, { state: "failed", error: "x".repeat(600) })
    await POST(b.req, b.res)
    expect(mockLoadPushValues).not.toHaveBeenCalled()
    expect(b.offers.markSync.mock.calls[0][2].error).toHaveLength(500)
    expect(b.offers.markSync.mock.calls[0][2].effectivePrice).toBeUndefined()
  })
})
