import handler, { config } from "../order-events-recorder"

const mockRecord = jest.fn()
const mockWarn = jest.fn()
const container: any = {
  resolve: (k: string) => (k === "orderEvents" ? { recordOrderEvent: mockRecord } : { warn: mockWarn }),
}

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue(undefined)
  mockWarn.mockReset()
})

describe("order-events-recorder subscriber", () => {
  it("listens to order.canceled", () => {
    expect(config.event).toBe("order.canceled")
  })

  it("order.canceled recorded with actor unknown", async () => {
    await handler({ event: { name: "order.canceled", data: { id: "order_1" } }, container } as any)
    expect(mockRecord).toHaveBeenCalledWith({ order_id: "order_1", type: "order.canceled", actor: "unknown" })
  })

  it("never throws and logs only the order id", async () => {
    mockRecord.mockRejectedValue(new Error("boom"))
    await expect(
      handler({ event: { name: "order.canceled", data: { id: "order_1" } }, container } as any)
    ).resolves.toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith("Failed to record order event order.canceled for order order_1")
  })
})
