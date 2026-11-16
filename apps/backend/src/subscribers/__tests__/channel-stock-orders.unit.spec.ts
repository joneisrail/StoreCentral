import handler, { config } from "../channel-stock-orders"

const mockRun = jest.fn()
jest.mock("../../workflows/apply-order-to-channel-stock", () => ({
  applyOrderToChannelStockWorkflow: () => ({ run: (...a: unknown[]) => mockRun(...a) }),
}))

const mockWarn = jest.fn()
const container: any = { resolve: () => ({ warn: mockWarn }) }

beforeEach(() => {
  mockRun.mockReset().mockResolvedValue({ result: {} })
  mockWarn.mockReset()
})

describe("channel-stock-orders subscriber", () => {
  it("listens to order.placed and order.canceled", () => {
    expect(config.event).toEqual(["order.placed", "order.canceled"])
  })

  it("order.placed runs the workflow in placed mode", async () => {
    await handler({ event: { name: "order.placed", data: { id: "order_1" } }, container } as any)
    expect(mockRun).toHaveBeenCalledWith({ input: { order_id: "order_1", mode: "placed" } })
  })

  it("order.canceled runs the workflow in canceled mode", async () => {
    await handler({ event: { name: "order.canceled", data: { id: "order_1" } }, container } as any)
    expect(mockRun).toHaveBeenCalledWith({ input: { order_id: "order_1", mode: "canceled" } })
  })

  it("never throws and logs only the order id", async () => {
    mockRun.mockRejectedValue(new Error("secret customer@example.com"))
    await expect(
      handler({ event: { name: "order.placed", data: { id: "order_1" } }, container } as any)
    ).resolves.toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith("Failed to apply order order_1 to channel stock (placed)")
  })
})
