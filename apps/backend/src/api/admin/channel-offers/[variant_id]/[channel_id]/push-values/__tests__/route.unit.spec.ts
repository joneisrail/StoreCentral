import { GET } from "../route"

const mockFetchConnected = jest.fn()
jest.mock("../../../../connections", () => ({
  fetchConnectedChannelIds: (...a: unknown[]) => mockFetchConnected(...a),
  connectedChannelIds: async () => new Set(),
}))

function req() {
  const query = {
    graph: jest.fn(async (q: any) => {
      if (q.entity === "sales_channel")
        return { data: [{ id: "sc_amz", name: "Amazon", metadata: { is_web: true } }] }
      if (q.entity === "product_variant") return { data: [{ id: "v1" }] }
      if (q.entity === "store")
        return {
          data: [
            {
              id: "st",
              default_sales_channel_id: "sc_web",
              supported_currencies: [{ currency_code: "usd", is_default: true }],
            },
          ],
        }
      return { data: [{ id: "v1", price_set: { prices: [] } }] }
    }),
  }
  const offers = { listChannelOffers: jest.fn(async () => [{ price: 12, stock: 4 }]) }
  return {
    params: { variant_id: "v1", channel_id: "sc_amz" },
    scope: { resolve: (k: string) => (k === "query" ? query : offers) },
  } as any
}

describe("GET push-values", () => {
  it("fails (no response) when the connection lookup fails instead of failing open", async () => {
    mockFetchConnected.mockRejectedValue(new Error("hub down"))
    const res = { json: jest.fn() } as any
    await expect(GET(req(), res)).rejects.toThrow("hub down")
    expect(res.json).not.toHaveBeenCalled()
  })
})
