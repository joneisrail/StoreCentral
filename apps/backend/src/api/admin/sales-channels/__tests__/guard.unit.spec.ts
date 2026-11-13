import { SellerHubError, callSellerHub } from "../../marketplace-connections/seller-hub-client"
import { DELETE_BLOCKED_MESSAGE, guardSalesChannelDelete } from "../guard"

jest.mock("../../marketplace-connections/seller-hub-client", () => {
  const actual = jest.requireActual("../../marketplace-connections/seller-hub-client")
  return { ...actual, callSellerHub: jest.fn() }
})
const mocked = callSellerHub as jest.Mock

const run = async () => {
  const res: any = { statusCode: 200, payload: undefined }
  res.status = (c: number) => ((res.statusCode = c), res)
  res.json = (b: unknown) => ((res.payload = b), res)
  const next = jest.fn()
  await guardSalesChannelDelete({ params: { id: "sc_1" } } as any, res, next)
  return { res, next }
}

beforeEach(() => mocked.mockReset())

describe("guardSalesChannelDelete", () => {
  it("delete guard blocks a channel with a connection", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { connections: [{ id: "c1", sales_channel_id: "sc_1", status: "error" }] },
    })
    const { res, next } = await run()
    expect(res.statusCode).toBe(400)
    expect(res.payload.message).toBe(DELETE_BLOCKED_MESSAGE)
    expect(next).not.toHaveBeenCalled()
  })

  it("delete guard blocks a connected channel", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { connections: [{ id: "c1", sales_channel_id: "sc_1", status: "connected" }] },
    })
    const { res, next } = await run()
    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })

  it("delete guard allows a channel whose connection is disconnected", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { connections: [{ id: "c1", sales_channel_id: "sc_1", status: "disconnected" }] },
    })
    const { res, next } = await run()
    expect(res.statusCode).toBe(200)
    expect(next).toHaveBeenCalled()
  })

  it("delete guard allows a channel with none", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { connections: [{ id: "c1", sales_channel_id: "sc_other" }] },
    })
    const { next } = await run()
    expect(next).toHaveBeenCalled()
  })

  it("delete guard allows deletion when seller-hub is unreachable", async () => {
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const { next } = await run()
    expect(next).toHaveBeenCalled()
  })

  it("allows deletion when seller-hub answers with an error status", async () => {
    mocked.mockResolvedValue({ status: 500, body: {} })
    const { next } = await run()
    expect(next).toHaveBeenCalled()
  })
})
