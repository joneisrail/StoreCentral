const mockCreateTags = jest.fn()
const mockBulk = jest.fn()
const mockBulkCompensate = jest.fn()
const mockUpdate = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => {
  const sdk = require("@medusajs/framework/workflows-sdk")
  const wrap = (name: string, fn: (input: any) => any, comp?: (input: any) => any) => {
    const step = sdk.createStep(
      `fake-${name}-step`,
      async (input: any) => new sdk.StepResponse(await fn(input), input),
      async (input: any) => {
        if (comp) await comp(input)
      }
    )
    return sdk.createWorkflow(`fake-${name}`, function (input: any) {
      return new sdk.WorkflowResponse(step(input))
    })
  }
  return {
    createOrderTagsWorkflow: wrap("create-tags", (i) => mockCreateTags(i)),
    bulkTagOrdersWorkflow: wrap("bulk-tag", (i) => mockBulk(i), (i) => mockBulkCompensate(i)),
    updateOrderWorkflow: wrap("update-order", (i) => mockUpdate(i)),
  }
})

import { createMedusaContainer, MedusaError } from "@medusajs/framework/utils"
import { holdOrderWorkflow } from "../hold-order"
import { releaseOrderWorkflow } from "../release-order"

const makeContainer = (order: any | undefined, tags: any[] = []) => {
  const container = createMedusaContainer()
  const query = {
    graph: async ({ entity }: { entity: string }) => ({
      data: entity === "order" ? (order ? [order] : []) : tags,
    }),
  }
  container.register("query", { resolve: () => query } as any)
  return container
}

const openOrder = (extra: any = {}) => ({
  id: "order_1",
  status: "pending",
  fulfillments: [],
  metadata: {},
  tags: [],
  ...extra,
})

const runHold = (container: any, input: any = {}) =>
  holdOrderWorkflow(container).run({
    input: { order_id: "order_1", reason: "Check address", user_id: "user_1", ...input },
  })

beforeEach(() => {
  jest.resetAllMocks()
  mockCreateTags.mockResolvedValue([{ id: "otag_new", value: "On hold" }])
})

describe("holdOrderWorkflow", () => {
  it("hold creates the On hold tag only when missing", async () => {
    await runHold(makeContainer(openOrder(), []))
    expect(mockCreateTags).toHaveBeenCalledWith({ order_tags: [{ value: "On hold" }] })
    expect(mockBulk).toHaveBeenCalledWith({ order_ids: ["order_1"], add: ["otag_new"] })

    mockCreateTags.mockClear()
    mockBulk.mockClear()
    await runHold(makeContainer(openOrder(), [{ id: "otag_old", value: "On hold" }]))
    expect(mockCreateTags).not.toHaveBeenCalled()
    expect(mockBulk).toHaveBeenCalledWith({ order_ids: ["order_1"], add: ["otag_old"] })
  })

  it("hold attaches the tag and writes metadata.hold with reason, held_at and held_by", async () => {
    const { result } = await runHold(makeContainer(openOrder(), [{ id: "otag_old", value: "On hold" }]))
    expect(result).toEqual({ order_id: "order_1", tag_id: "otag_old" })
    const update = mockUpdate.mock.calls[0][0]
    expect(update.id).toBe("order_1")
    expect(update.metadata.hold).toEqual({
      reason: "Check address",
      held_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      held_by: "user_1",
    })
  })

  it("hold records held_by null without a user", async () => {
    await runHold(makeContainer(openOrder(), []), { user_id: undefined })
    expect(mockUpdate.mock.calls[0][0].metadata.hold.held_by).toBeNull()
  })

  it("hold keeps unrelated metadata keys", async () => {
    await runHold(makeContainer(openOrder({ metadata: { gift: true, note: "x" } }), []))
    const { metadata } = mockUpdate.mock.calls[0][0]
    expect(metadata.gift).toBe(true)
    expect(metadata.note).toBe("x")
    expect(metadata.hold.reason).toBe("Check address")
  })

  it("hold rejects a canceled order", async () => {
    await expect(runHold(makeContainer(openOrder({ status: "canceled" })))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    expect(mockBulk).not.toHaveBeenCalled()
  })

  const f = (extra: any = {}) => ({ id: "ful_" + Math.random(), ...extra })
  const T = "2026-01-01T00:00:00Z"

  it.each([
    ["one shipped fulfillment", [f({ shipped_at: T })]],
    ["one delivered fulfillment", [f({ shipped_at: T, delivered_at: T })]],
    ["one packed fulfillment (fulfilled)", [f({ packed_at: T })]],
    ["one shipped and one unshipped (partially_shipped)", [f({ shipped_at: T }), f()]],
    ["shipped plus a canceled one", [f({ shipped_at: T }), f({ canceled_at: T })]],
  ])("hold rejects a shipped order: %s", async (_name, fulfillments) => {
    await expect(runHold(makeContainer(openOrder({ fulfillments })))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    expect(mockBulk).not.toHaveBeenCalled()
  })

  it.each([
    ["no fulfillments", []],
    ["a canceled fulfillment only", [f({ canceled_at: T })]],
    ["one packed of two (partially_fulfilled)", [f({ packed_at: T }), f()]],
  ])("hold accepts an open order: %s", async (_name, fulfillments) => {
    await runHold(makeContainer(openOrder({ fulfillments })))
    expect(mockBulk).toHaveBeenCalled()
  })

  it("hold fails closed when the fulfillments relation is not readable", async () => {
    await expect(runHold(makeContainer(openOrder({ fulfillments: undefined })))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    expect(mockBulk).not.toHaveBeenCalled()
  })

  it("release does not need the fulfillments relation", async () => {
    const order = openOrder({ fulfillments: undefined, tags: [{ id: "otag_old", value: "On hold" }] })
    await releaseOrderWorkflow(makeContainer(order)).run({ input: { order_id: "order_1" } })
    expect(mockBulk).toHaveBeenCalled()
  })

  it("hold rejects an already held order", async () => {
    const order = openOrder({ tags: [{ id: "otag_old", value: "On hold" }] })
    await expect(runHold(makeContainer(order))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    expect(mockBulk).not.toHaveBeenCalled()
  })

  it("hold rejects an unknown order as not found", async () => {
    await expect(runHold(makeContainer(undefined))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
  })

  it("hold removes the tag again when the metadata write fails", async () => {
    mockUpdate.mockRejectedValue(new Error("db down"))
    const r = await runHold(makeContainer(openOrder(), [{ id: "otag_old", value: "On hold" }])).catch((e: any) => e)
    expect(r).toMatchObject({ message: "db down" })
    expect(mockBulkCompensate).toHaveBeenCalledWith({ order_ids: ["order_1"], add: ["otag_old"] })
  })
})

describe("releaseOrderWorkflow", () => {
  const held = () => openOrder({ tags: [{ id: "otag_old", value: "On hold" }, { id: "otag_x", value: "vip" }] })

  it("release removes the tag and clears metadata.hold", async () => {
    const { result } = await releaseOrderWorkflow(makeContainer(held())).run({ input: { order_id: "order_1" } })
    expect(result).toEqual({ order_id: "order_1" })
    expect(mockBulk).toHaveBeenCalledWith({ order_ids: ["order_1"], remove: ["otag_old"] })
    expect(mockUpdate).toHaveBeenCalledWith({ id: "order_1", metadata: { hold: "" } })
  })

  it("release rejects an order that is not held", async () => {
    await expect(
      releaseOrderWorkflow(makeContainer(openOrder())).run({ input: { order_id: "order_1" } })
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_ALLOWED })
    expect(mockBulk).not.toHaveBeenCalled()
  })
})
