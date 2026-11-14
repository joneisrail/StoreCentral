const mockCancel = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  cancelOrderFulfillmentWorkflow: () => ({ run: (i: any) => mockCancel(i) }),
}))

import { createMedusaContainer, MedusaError } from "@medusajs/framework/utils"
import { voidOrderLabelWorkflow } from "../void-order-label"

const makeContainer = (order: any | undefined) => {
  const container = createMedusaContainer()
  const query = { graph: async () => ({ data: order ? [order] : [] }) }
  container.register("query", { resolve: () => query } as any)
  return container
}

const T = "2026-01-01T00:00:00Z"
const label = (id: string, extra: any = {}) => ({ id, data: { easypost_shipment_id: `shp_${id}` }, ...extra })
const orderWith = (fulfillments: any) => ({ id: "order_1", fulfillments })
const run = (container: any) => voidOrderLabelWorkflow(container).run({ input: { order_id: "order_1" } })

beforeEach(() => {
  jest.resetAllMocks()
  mockCancel.mockResolvedValue({})
})

describe("voidOrderLabelWorkflow", () => {
  it("voids a label fulfillment and returns its id", async () => {
    const { result } = await run(makeContainer(orderWith([label("ful_1")])))
    expect(mockCancel).toHaveBeenCalledWith({
      input: { order_id: "order_1", fulfillment_id: "ful_1", no_notification: true },
    })
    expect(result).toEqual({ order_id: "order_1", voided: [{ fulfillment_id: "ful_1" }] })
  })

  it("voids every unshipped label fulfillment and skips canceled or label-less ones", async () => {
    const order = orderWith([
      label("ful_1"),
      label("ful_2"),
      label("ful_3", { canceled_at: T }),
      { id: "ful_4", data: {} },
    ])
    const { result } = await run(makeContainer(order))
    expect(mockCancel).toHaveBeenCalledTimes(2)
    expect(result.voided.map((v: any) => v.fulfillment_id)).toEqual(["ful_1", "ful_2"])
  })

  it("rejects when nothing is voidable", async () => {
    await expect(run(makeContainer(orderWith([{ id: "ful_4", data: {} }])))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: "There is no unshipped label to void",
    })
    await expect(run(makeContainer(orderWith([])))).rejects.toMatchObject({ type: MedusaError.Types.NOT_ALLOWED })
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it.each([
    ["shipped", { shipped_at: T }],
    ["delivered", { delivered_at: T }],
  ])("rejects the whole request when any fulfillment is %s", async (_n, extra) => {
    const order = orderWith([label("ful_1"), label("ful_2", extra)])
    await expect(run(makeContainer(order))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: expect.stringMatching(/already shipped/),
    })
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it("ignores a canceled shipped fulfillment", async () => {
    await run(makeContainer(orderWith([label("ful_1"), label("ful_2", { shipped_at: T, canceled_at: T })])))
    expect(mockCancel).toHaveBeenCalledTimes(1)
  })

  it("rejects when fulfillments cannot be read", async () => {
    await expect(run(makeContainer(orderWith(undefined)))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it("rejects an unknown order as not found", async () => {
    await expect(run(makeContainer(undefined))).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
  })

  it("a refund failure surfaces as NOT_ALLOWED and no further fulfillment is attempted", async () => {
    mockCancel.mockRejectedValueOnce(new Error("carrier says no"))
    await expect(run(makeContainer(orderWith([label("ful_1"), label("ful_2")])))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: expect.stringContaining("carrier says no"),
    })
    expect(mockCancel).toHaveBeenCalledTimes(1)
  })

  it("names already-voided fulfillments when a later refund fails", async () => {
    mockCancel.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("carrier says no"))
    await expect(run(makeContainer(orderWith([label("ful_1"), label("ful_2")])))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: "Fulfillment(s) ful_1 were already voided; the refund for ful_2 failed: carrier says no",
    })
  })
})
