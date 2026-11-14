import { createMedusaContainer } from "@medusajs/framework/utils"
import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { recordOrderEventStep } from "../record-order-event"

const wf = createWorkflow("test-record-order-event", function (input: any) {
  recordOrderEventStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(transform({ input }, ({ input }) => input.order_id))
})

const mockRecord = jest.fn()
const mockWarn = jest.fn()
const make = (withService = true) => {
  const c = createMedusaContainer()
  if (withService) c.register("orderEvents", { resolve: () => ({ recordOrderEvent: mockRecord }) } as any)
  c.register("logger", { resolve: () => ({ warn: mockWarn }) } as any)
  return c
}

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue(undefined)
  mockWarn.mockReset()
})

describe("recordOrderEventStep", () => {
  it("stores an event, defaulting the actor to unknown", async () => {
    await wf(make()).run({ input: { order_id: "order_1", type: "order.held", new_value: { reason: "x" } } })
    expect(mockRecord).toHaveBeenCalledWith({
      order_id: "order_1",
      type: "order.held",
      actor: "unknown",
      old_value: undefined,
      new_value: { reason: "x" },
    })
    await wf(make()).run({ input: { order_id: "order_1", type: "order.held", actor: "user_1" } })
    expect(mockRecord.mock.calls[1][0].actor).toBe("user_1")
  })

  it("swallows a failing service and logs only order id and type", async () => {
    mockRecord.mockRejectedValue(new Error("secret tracking 1Z999 reason"))
    await expect(
      wf(make()).run({
        input: { order_id: "order_1", type: "order.marked_shipped", new_value: { tracking_number: "1Z999" } },
      })
    ).resolves.toBeDefined()
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][0]).toBe("Failed to record order event order.marked_shipped for order order_1")
  })

  it("swallows a missing module and a missing logger", async () => {
    await expect(wf(make(false)).run({ input: { order_id: "order_1", type: "order.held" } })).resolves.toBeDefined()
    const c = createMedusaContainer()
    await expect(wf(c).run({ input: { order_id: "order_1", type: "order.held" } })).resolves.toBeDefined()
  })
})
