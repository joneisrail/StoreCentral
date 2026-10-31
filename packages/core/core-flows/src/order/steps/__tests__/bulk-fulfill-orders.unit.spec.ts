import { MedusaContainer } from "@medusajs/framework"
import { asFunction, createContainer } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk"
import { bulkFulfillOrdersStep } from "../bulk-fulfill-orders"

// `createOrderFulfillmentWorkflow` is imported directly by the step (not
// resolved from the container), so it's mocked at the module level. The
// mock is configured per-test via `mockCreateOrderFulfillmentWorkflow`.
jest.mock("../../workflows/create-fulfillment", () => ({
  createOrderFulfillmentWorkflow: jest.fn(),
}))

const { createOrderFulfillmentWorkflow } = jest.requireMock(
  "../../workflows/create-fulfillment"
) as { createOrderFulfillmentWorkflow: jest.Mock }

type OrderFixture = {
  id: string
  items: { id: string; quantity: number; detail?: { fulfilled_quantity?: number } }[]
}

const buildContainer = ({
  orders,
  buyRate,
  createLabelBatch,
}: {
  orders: Record<string, OrderFixture>
  buyRate: (shipmentId: string, rateId: string) => Promise<any>
  createLabelBatch?: (shipmentIds: string[], format: string) => Promise<any>
}): {
  container: MedusaContainer
  calls: {
    buyRate: any[][]
    createLabelBatch: any[][]
    logs: { level: string; message: string }[]
  }
} => {
  const calls = {
    buyRate: [] as any[][],
    createLabelBatch: [] as any[][],
    logs: [] as { level: string; message: string }[],
  }

  const container = createContainer() as unknown as MedusaContainer

  container.register(
    ContainerRegistrationKeys.QUERY,
    asFunction(() => ({
      graph: async ({ filters }: any) => {
        const order = orders[filters.id]
        return { data: order ? [order] : [] }
      },
    }))
  )

  container.register(
    ContainerRegistrationKeys.LOGGER,
    asFunction(() => ({
      warn: (message: string) => calls.logs.push({ level: "warn", message }),
      error: (message: string) => calls.logs.push({ level: "error", message }),
      info: (message: string) => calls.logs.push({ level: "info", message }),
    }))
  )

  container.register(
    "fp_easypost_easypost",
    asFunction(() => ({
      buyRate: async (shipmentId: string, rateId: string) => {
        calls.buyRate.push([shipmentId, rateId])
        return buyRate(shipmentId, rateId)
      },
      createLabelBatch: async (shipmentIds: string[], format: string) => {
        calls.createLabelBatch.push([shipmentIds, format])
        if (!createLabelBatch) {
          return { labelUrl: undefined }
        }
        return createLabelBatch(shipmentIds, format)
      },
    }))
  )

  return { container, calls }
}

const runStep = async (container: MedusaContainer, input: any): Promise<any> => {
  const workflow = createWorkflow(
    `bulk-fulfill-orders-test-${Math.random().toString(36).slice(2)}`,
    () => {
      const out = bulkFulfillOrdersStep(input)
      return new WorkflowResponse(out)
    }
  )
  const { result } = await workflow(container).run({ input: {} })
  return result
}

describe("bulkFulfillOrdersStep", () => {
  beforeEach(() => {
    createOrderFulfillmentWorkflow.mockReset()
  })

  it("buys the chosen rate and overrides provider data on createOrderFulfillmentWorkflow", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container, calls } = buildContainer({
      orders: {
        order_1: {
          id: "order_1",
          items: [{ id: "item_1", quantity: 2, detail: { fulfilled_quantity: 0 } }],
        },
      },
      buyRate: async () => ({
        id: "shp_1",
        trackingCode: "trk_1",
        labelUrl: "url",
        trackerId: "trker_1",
      }),
      createLabelBatch: async () => ({ labelUrl: "batch.pdf" }),
    })

    const result = await runStep(container, {
      fulfillments: [
        {
          order_id: "order_1",
          location_id: "sloc_1",
          shipment_id: "shp_quote",
          rate_id: "rate_1",
        },
      ],
    })

    expect(result.succeeded).toEqual(["order_1"])
    expect(result.failed).toEqual([])
    expect(result.label_pdf_url).toBe("batch.pdf")

    expect(calls.buyRate).toEqual([["shp_quote", "rate_1"]])

    expect(run).toHaveBeenCalledTimes(1)
    const runInput = run.mock.calls[0][0].input
    expect(runInput.order_id).toBe("order_1")
    expect(runInput.location_id).toBe("sloc_1")
    expect(runInput.provider_data_override).toEqual({
      easypost_shipment_id: "shp_1",
      easypost_rate_id: "rate_1",
      easypost_tracking_code: "trk_1",
      easypost_label_url: "url",
      easypost_tracker_id: "trker_1",
    })

    expect(calls.createLabelBatch).toEqual([[["shp_1"], "pdf"]])
  })

  it("records the bought shipment id on a failure entry when buyRate succeeds but fulfillment creation fails", async () => {
    const run = jest.fn().mockRejectedValue(new Error("fulfillment creation failed"))
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container } = buildContainer({
      orders: {
        order_1: {
          id: "order_1",
          items: [{ id: "item_1", quantity: 1, detail: { fulfilled_quantity: 0 } }],
        },
      },
      buyRate: async () => ({ id: "shp_1", trackingCode: "trk_1", labelUrl: "url" }),
      createLabelBatch: async () => ({ labelUrl: "batch.pdf" }),
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_1", shipment_id: "shp_quote", rate_id: "rate_1" },
      ],
    })

    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual([
      {
        order_id: "order_1",
        error: "fulfillment creation failed",
        easypost_shipment_id: "shp_1",
      },
    ])

    // The bought shipment still goes into the consolidated label batch -
    // the label was already purchased with real money regardless of
    // whether the Medusa fulfillment record could be created afterward.
    expect(result.label_pdf_url).toBe("batch.pdf")
  })

  it("one order's buyRate failure does not block the others in the same batch", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container } = buildContainer({
      orders: {
        order_fail: {
          id: "order_fail",
          items: [{ id: "item_a", quantity: 1, detail: { fulfilled_quantity: 0 } }],
        },
        order_ok: {
          id: "order_ok",
          items: [{ id: "item_b", quantity: 1, detail: { fulfilled_quantity: 0 } }],
        },
      },
      buyRate: async (shipmentId: string) => {
        if (shipmentId === "shp_a") {
          throw new Error("rate expired")
        }
        return { id: "shp_b", trackingCode: "trk_b", labelUrl: "url_b" }
      },
      createLabelBatch: async () => ({ labelUrl: "batch.pdf" }),
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_fail", shipment_id: "shp_a", rate_id: "rate_a" },
        { order_id: "order_ok", shipment_id: "shp_b", rate_id: "rate_b" },
      ],
    })

    expect(result.succeeded).toEqual(["order_ok"])
    expect(result.failed).toEqual([
      { order_id: "order_fail", error: "rate expired" },
    ])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("a label-batch generation failure does not undo already-succeeded fulfillments", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container, calls } = buildContainer({
      orders: {
        order_1: {
          id: "order_1",
          items: [{ id: "item_1", quantity: 1, detail: { fulfilled_quantity: 0 } }],
        },
      },
      buyRate: async () => ({ id: "shp_1", trackingCode: "trk_1", labelUrl: "url" }),
      createLabelBatch: async () => {
        throw new Error("EasyPost batch endpoint timed out")
      },
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_1", shipment_id: "shp_1", rate_id: "rate_1" },
      ],
    })

    expect(result.succeeded).toEqual(["order_1"])
    expect(result.failed).toEqual([])
    expect(result.label_pdf_url).toBeUndefined()

    expect(calls.logs.some((l) => l.level === "warn")).toBe(true)
  })
})
