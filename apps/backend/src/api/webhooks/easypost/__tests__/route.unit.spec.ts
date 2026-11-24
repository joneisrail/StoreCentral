const mockCreateShipment = jest.fn()
const mockDelivered = jest.fn()
const mockEmit = jest.fn()
const mockRecord = jest.fn()
const mockWarn = jest.fn()
const mockError = jest.fn()
let fulfillment: any
let linkOrderId: string | undefined

jest.mock("@medusajs/medusa/core-flows", () => ({
  createShipmentWorkflow: () => ({ run: (i: any) => mockCreateShipment(i) }),
  markFulfillmentAsDeliveredWorkflow: () => ({ run: (i: any) => mockDelivered(i) }),
}))
// The route imports a helper from the seller-hub-sync subscriber, which loads the
// propagate-base-price workflow; that needs core-flows pieces this spec does not mock.
jest.mock("../../../../workflows/propagate-base-price", () => ({
  __esModule: true,
  default: () => ({ run: jest.fn() }),
}))
jest.mock("@dtc/fulfillment-easypost", () => ({
  EasyPostClient: class {
    verifyWebhookSignature() {
      return true
    }
  },
}))

import { POST } from "../route"

const scope: any = {
  resolve: (k: string) => {
    if (k === "query")
      return {
        graph: async ({ entity }: any) =>
          entity === "fulfillment"
            ? { data: fulfillment ? [fulfillment] : [] }
            : { data: linkOrderId ? [{ order_id: linkOrderId }] : [] },
      }
    if (k === "event_bus") return { emit: mockEmit }
    if (k === "orderEvents") return { recordOrderEvent: mockRecord }
    if (k === "logger") return { warn: mockWarn, error: mockError }
    throw new Error(`unexpected ${k}`)
  },
}

const call = async (status: string) => {
  const res: any = { sendStatus: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() }
  await POST(
    {
      rawBody: "{}",
      headers: { "x-hmac-signature": "sig" },
      body: { result: { tracking_code: "TRK1", status } },
      scope,
    } as any,
    res
  )
  return res
}

beforeEach(() => {
  process.env.EASYPOST_WEBHOOK_SECRET = "secret"
  jest.resetAllMocks()
  mockEmit.mockResolvedValue(undefined)
  mockRecord.mockResolvedValue(undefined)
  mockCreateShipment.mockResolvedValue({})
  mockDelivered.mockResolvedValue({})
  linkOrderId = "order_1"
  fulfillment = { id: "ful_1", shipping_option_id: "so_1", labels: [] }
})

describe("easypost webhook order events", () => {
  it("records order.shipped once on the creating update and none on repeats", async () => {
    const res = await call("in_transit")
    expect(res.sendStatus).toHaveBeenCalledWith(200)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockRecord).toHaveBeenCalledWith({
      order_id: "order_1",
      type: "order.shipped",
      actor: "system",
      new_value: { fulfillment_id: "ful_1" },
    })
    // A repeat: the fulfillment is already shipped, nothing is created or recorded.
    fulfillment = { ...fulfillment, shipped_at: "2026-01-01T00:00:00Z" }
    await call("in_transit")
    expect(mockCreateShipment).toHaveBeenCalledTimes(1)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it("records order.delivered on delivered, once", async () => {
    await call("delivered")
    expect(mockRecord).toHaveBeenCalledWith({
      order_id: "order_1",
      type: "order.delivered",
      actor: "system",
      new_value: { fulfillment_id: "ful_1" },
    })
    fulfillment = { ...fulfillment, delivered_at: "2026-01-02T00:00:00Z" }
    await call("delivered")
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it("a failing event write keeps the 200 and logs only the type", async () => {
    mockRecord.mockRejectedValue(new Error("db down TRK1"))
    const res = await call("in_transit")
    expect(res.sendStatus).toHaveBeenCalledWith(200)
    expect(mockWarn).toHaveBeenCalledWith("Failed to record order event order.shipped")
    expect(mockError).not.toHaveBeenCalled()
  })

  it("a missing order link records nothing and keeps the 200", async () => {
    linkOrderId = undefined
    const res = await call("in_transit")
    expect(res.sendStatus).toHaveBeenCalledWith(200)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it("a failing emit still records the event and keeps the 200", async () => {
    mockEmit.mockRejectedValue(new Error("bus down"))
    const res = await call("in_transit")
    expect(res.sendStatus).toHaveBeenCalledWith(200)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })
})
