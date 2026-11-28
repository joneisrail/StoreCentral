import { GET } from "../../api/store/search/trending/route"

describe("GET /store/search/trending order scan", () => {
  it("scans orders newest first", async () => {
    const graph = jest.fn(async ({ entity }: { entity: string }) =>
      entity === "order"
        ? { data: [{ id: "order_1", items: [{ product_id: "prod_1", quantity: 2 }] }] }
        : { data: [] }
    )
    const logger = { warn: jest.fn(), error: jest.fn() }
    const req: any = {
      query: { limit: "4" },
      publishable_key_context: { sales_channel_ids: ["sc_order_scan_test"] },
      scope: {
        resolve: (key: string) => (key === "query" ? { graph } : logger),
      },
    }
    const res: any = { setHeader: jest.fn(), json: jest.fn() }

    await GET(req, res)

    const orderCall = graph.mock.calls.find(([q]) => q.entity === "order") as any
    expect(orderCall).toBeDefined()
    expect(orderCall[0].pagination.order).toEqual({ created_at: "DESC" })
    expect(res.json).toHaveBeenCalled()
  })
})
