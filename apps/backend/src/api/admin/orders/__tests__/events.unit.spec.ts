import { MedusaError } from "@medusajs/framework/utils"
import { GET } from "../[id]/events/route"

const mockGraph = jest.fn()
const mockList = jest.fn()
const mockListUsers = jest.fn()
const scope: any = {
  resolve: (k: string) =>
    k === "query" ? { graph: mockGraph } : k === "orderEvents" ? { listForOrder: mockList } : { listUsers: mockListUsers },
}
const makeRes = () => {
  const res: any = {}
  res.json = (b: unknown) => ((res.payload = b), res)
  return res
}
const req = () => ({ params: { id: "order_1" }, scope }) as any
const row = (id: string, actor: string, extra: any = {}) => ({
  id,
  order_id: "order_1",
  type: "order.held",
  actor,
  old_value: null,
  new_value: null,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
})

beforeEach(() => {
  mockGraph.mockReset().mockResolvedValue({ data: [{ id: "order_1" }] })
  mockList.mockReset()
  mockListUsers.mockReset()
})

describe("GET /admin/orders/:id/events", () => {
  it("lists events in service order with resolved actors and one batched user lookup", async () => {
    mockList.mockResolvedValue([
      row("e3", "user_1", { new_value: { reason: "x" } }),
      row("e2", "system"),
      row("e1", "user_2"),
      row("e0", "unknown"),
      row("e9", "user_gone"),
      row("e8", "user_1"),
    ])
    mockListUsers.mockResolvedValue([
      { id: "user_1", first_name: "Ada", last_name: "Lovelace", email: "a@x.com" },
      { id: "user_2", first_name: null, last_name: null, email: "bob@x.com" },
    ])
    const res = makeRes()
    await GET(req(), res)
    expect(mockList).toHaveBeenCalledWith("order_1", 200)
    expect(mockListUsers).toHaveBeenCalledTimes(1)
    expect(mockListUsers.mock.calls[0][0]).toEqual({ id: ["user_1", "user_2", "user_gone"] })
    expect(res.payload.events.map((e: any) => e.actor)).toEqual([
      { id: "user_1", name: "Ada Lovelace" },
      "system",
      { id: "user_2", name: "bob" },
      { id: "unknown", name: null },
      { id: "user_gone", name: null },
      { id: "user_1", name: "Ada Lovelace" },
    ])
    expect(res.payload.events[0]).toEqual({
      id: "e3",
      type: "order.held",
      actor: { id: "user_1", name: "Ada Lovelace" },
      old_value: null,
      new_value: { reason: "x" },
      created_at: "2026-01-01T00:00:00Z",
    })
  })

  it("skips the user lookup when only system events exist", async () => {
    mockList.mockResolvedValue([row("e1", "system")])
    const res = makeRes()
    await GET(req(), res)
    expect(mockListUsers).not.toHaveBeenCalled()
    expect(res.payload.events[0].actor).toBe("system")
  })

  it("404s for an unknown order", async () => {
    mockGraph.mockResolvedValue({ data: [] })
    await expect(GET(req(), makeRes())).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
    expect(mockList).not.toHaveBeenCalled()
  })
})
