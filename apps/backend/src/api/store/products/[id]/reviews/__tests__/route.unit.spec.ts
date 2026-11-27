import { GET } from "../route"

function setup(pageRows: any[], allRows: any[], queryParams: Record<string, unknown> = {}) {
  const graph = jest.fn(async (args: any) =>
    args.pagination ? { data: pageRows } : { data: allRows }
  )
  const header = jest.fn()
  const json = jest.fn()
  const req: any = {
    params: { id: "prod_1" },
    query: queryParams,
    scope: { resolve: jest.fn(() => ({ graph })) },
  }
  const res: any = { json, setHeader: header, header }
  return { req, res, graph, json, header }
}

describe("GET /store/products/:id/reviews", () => {
  it("filters by product and approved status in both queries", async () => {
    const { req, res, graph } = setup([], [])
    await GET(req, res)
    expect(graph).toHaveBeenCalledTimes(2)
    for (const [args] of graph.mock.calls) {
      expect(args.entity).toBe("review")
      expect(args.filters).toEqual({ product_id: "prod_1", status: "approved" })
    }
    const paged = graph.mock.calls.find(([a]: any) => a.pagination)![0]
    expect(paged.pagination).toEqual({ take: 10, skip: 0, order: { created_at: "DESC" } })
    expect(paged.fields).toContain("customer.first_name")
    expect(paged.fields).not.toContain("customer.email")
  })

  it("computes count and average from the full approved set", async () => {
    const page = [
      { id: "r1", rating: 5, title: "t", comment: "c", created_at: "2026-11-04T00:00:00.000Z", customer: { first_name: "Ana" } },
    ]
    const { req, res, json, header } = setup(page, [{ rating: 5 }, { rating: 5 }, { rating: 4 }], {
      limit: "1",
      offset: "0",
    })
    await GET(req, res)
    expect(header).toHaveBeenCalledWith("Cache-Control", "public, max-age=60")
    expect(json).toHaveBeenCalledWith({
      reviews: [
        { id: "r1", rating: 5, title: "t", comment: "c", created_at: "2026-11-04T00:00:00.000Z", author: "Ana" },
      ],
      count: 3,
      average: 4.7,
      limit: 1,
      offset: 0,
    })
  })

  it("returns null average when there are no reviews", async () => {
    const { req, res, json } = setup([], [])
    await GET(req, res)
    expect(json.mock.calls[0][0]).toMatchObject({ reviews: [], count: 0, average: null })
  })
})
