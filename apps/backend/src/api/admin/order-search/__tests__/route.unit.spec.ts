import { GET } from "../route"

const mockGraph = jest.fn()
const scope: any = { resolve: (k: string) => (k === "query" ? { graph: mockGraph } : undefined) }
const makeRes = () => {
  const res: any = {}
  res.json = (b: unknown) => ((res.payload = b), res)
  return res
}

describe("GET /admin/order-search", () => {
  it("passes the validated query to the search and responds with ids and truncated", async () => {
    mockGraph.mockReset().mockResolvedValue({ data: [{ id: "order_1" }, { id: "order_2" }] })
    const res = makeRes()
    await GET({ scope, validatedQuery: { country: "US" } } as any, res)
    expect(res.payload).toEqual({ order_ids: ["order_1", "order_2"], truncated: false })
    expect(mockGraph.mock.calls[0][0].filters.shipping_address).toEqual({ country_code: { $ilike: "US" } })
  })
})
