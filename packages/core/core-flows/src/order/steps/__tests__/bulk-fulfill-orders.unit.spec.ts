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

// The EasyPost provider lives in the Fulfillment Module's own container, and
// the step reaches it through this helper - which is replaced here by the
// per-test fake provider. The helper itself is covered by its own unit test
// and, against the real module, by the backend HTTP integration tests.
jest.mock("../../utils/resolve-easypost-provider", () => ({
  ...jest.requireActual("../../utils/resolve-easypost-provider"),
  resolveEasyPostFulfillmentProvider: jest.fn(),
}))

const { createOrderFulfillmentWorkflow } = jest.requireMock(
  "../../workflows/create-fulfillment"
) as { createOrderFulfillmentWorkflow: jest.Mock }

const { resolveEasyPostFulfillmentProvider } = jest.requireMock(
  "../../utils/resolve-easypost-provider"
) as { resolveEasyPostFulfillmentProvider: jest.Mock }

type ItemFixture = {
  id: string
  quantity: number
  detail?: { fulfilled_quantity?: number }
  title?: string
  requires_shipping?: boolean
  variant?: {
    manage_inventory?: boolean
    product?: { shipping_profile?: { id: string } }
    inventory_items?: { inventory_item_id: string }[]
  }
}

type OrderFixture = {
  id: string
  status?: string
  items: ItemFixture[]
  shipping_methods?: { shipping_option_id?: string }[]
}

const SHIPPING_OPTION = {
  id: "so_1",
  shipping_profile_id: "sp_1",
  service_zone: { fulfillment_set: { location: { id: "sloc_option" } } },
}

// An order with one managed-inventory item, stocked (inventory level) at
// `sloc_1` and reserved - i.e. fulfillable from `sloc_1`.
const fulfillableOrder = (
  id: string,
  overrides: Partial<OrderFixture> = {}
): OrderFixture => ({
  id,
  status: "pending",
  shipping_methods: [{ shipping_option_id: SHIPPING_OPTION.id }],
  items: [
    {
      id: `${id}_item`,
      title: `${id} item`,
      quantity: 1,
      requires_shipping: true,
      detail: { fulfilled_quantity: 0 },
      variant: {
        manage_inventory: true,
        product: { shipping_profile: { id: "sp_1" } },
        inventory_items: [{ inventory_item_id: `${id}_iitem` }],
      },
    },
  ],
  ...overrides,
})

const buildContainer = ({
  orders,
  buyRate,
  createLabelBatch,
  inventoryLevels,
  reservations,
}: {
  orders: Record<string, OrderFixture>
  buyRate: (shipmentId: string, rateId: string) => Promise<any>
  createLabelBatch?: (shipmentIds: string[], format: string) => Promise<any>
  inventoryLevels?: { inventory_item_id: string; location_id: string }[]
  reservations?: { line_item_id: string }[]
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

  // By default every order's items are stocked at sloc_1 and reserved.
  const allItems = Object.values(orders).flatMap((order) => order.items)
  const levels =
    inventoryLevels ??
    allItems.flatMap((item) =>
      (item.variant?.inventory_items ?? []).map((link) => ({
        inventory_item_id: link.inventory_item_id,
        location_id: "sloc_1",
      }))
    )
  const reserved =
    reservations ?? allItems.map((item) => ({ line_item_id: item.id }))

  const container = createContainer() as unknown as MedusaContainer

  container.register(
    ContainerRegistrationKeys.QUERY,
    asFunction(() => ({
      graph: async ({ entity, filters }: any) => {
        switch (entity) {
          case "order": {
            const order = orders[filters.id]
            return { data: order ? [order] : [] }
          }
          case "shipping_option":
            return {
              data: filters.id === SHIPPING_OPTION.id ? [SHIPPING_OPTION] : [],
            }
          case "inventory_level":
            return {
              data: levels.filter(
                (level) =>
                  filters.inventory_item_id.includes(level.inventory_item_id) &&
                  level.location_id === filters.location_id
              ),
            }
          case "reservation":
            return {
              data: reserved.filter((reservation) =>
                filters.line_item_id.includes(reservation.line_item_id)
              ),
            }
          default:
            throw new Error(`unexpected query entity ${entity}`)
        }
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

  resolveEasyPostFulfillmentProvider.mockReturnValue({
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
  })

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
    resolveEasyPostFulfillmentProvider.mockReset()
  })

  it("forwards no_notification per order only when it was given", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container } = buildContainer({
      orders: {
        order_1: fulfillableOrder("order_1"),
        order_2: fulfillableOrder("order_2"),
      },
      buyRate: async () => ({ id: "shp_1" }),
      createLabelBatch: async () => ({ labelUrl: "batch.pdf" }),
    })

    await runStep(container, {
      fulfillments: [
        {
          order_id: "order_1",
          location_id: "sloc_1",
          shipment_id: "s1",
          rate_id: "r1",
          no_notification: true,
        },
        {
          order_id: "order_2",
          location_id: "sloc_1",
          shipment_id: "s2",
          rate_id: "r2",
        },
      ],
    })

    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0][0].input.no_notification).toBe(true)
    expect("no_notification" in run.mock.calls[1][0].input).toBe(false)
  })

  it("buys the chosen rate and creates the fulfillment under the EasyPost provider with the bought shipment's data", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container, calls } = buildContainer({
      orders: {
        order_1: fulfillableOrder("order_1", {
          items: [
            {
              ...fulfillableOrder("order_1").items[0],
              quantity: 2,
            },
          ],
        }),
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
    expect(runInput.items).toHaveLength(1)
    expect(runInput.items[0].id).toBe("order_1_item")
    expect(Number(runInput.items[0].quantity)).toBe(2)
    // Created under the provider that actually bought the label, not the
    // checkout shipping option's own provider.
    expect(runInput.provider_id).toBe("easypost_easypost")
    expect(runInput.provider_data_override).toEqual({
      easypost_shipment_id: "shp_1",
      easypost_rate_id: "rate_1",
      easypost_tracking_code: "trk_1",
      easypost_label_url: "url",
      easypost_tracker_id: "trker_1",
    })

    expect(calls.createLabelBatch).toEqual([[["shp_1"], "pdf"]])
  })

  it("records the bought shipment id on a failure entry when buyRate succeeds but fulfillment creation fails, and leaves it out of the label batch", async () => {
    const run = jest.fn().mockRejectedValue(new Error("fulfillment creation failed"))
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container, calls } = buildContainer({
      orders: { order_1: fulfillableOrder("order_1") },
      buyRate: async () => ({ id: "shp_1", trackingCode: "trk_1", labelUrl: "url" }),
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

    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual([
      {
        order_id: "order_1",
        error: "fulfillment creation failed",
        easypost_shipment_id: "shp_1",
      },
    ])

    // No order succeeded, so there's nothing to print: a label for an order
    // Medusa doesn't consider fulfilled is never put in the printable batch.
    expect(calls.createLabelBatch).toEqual([])
    expect(result.label_pdf_url).toBeUndefined()
  })

  it("only puts successfully fulfilled orders' shipments in the label batch when another order's fulfillment fails after its label was bought", async () => {
    const run = jest.fn(async ({ input }) => {
      if (input.order_id === "order_orphan") {
        throw new Error("fulfillment creation failed")
      }
      return {}
    })
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container, calls } = buildContainer({
      orders: {
        order_ok: fulfillableOrder("order_ok"),
        order_orphan: fulfillableOrder("order_orphan"),
      },
      buyRate: async (shipmentId: string) => ({
        id: `bought_${shipmentId}`,
        trackingCode: `trk_${shipmentId}`,
      }),
      createLabelBatch: async () => ({ labelUrl: "batch.pdf" }),
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_ok", location_id: "sloc_1", shipment_id: "shp_ok", rate_id: "rate_ok" },
        { order_id: "order_orphan", location_id: "sloc_1", shipment_id: "shp_orphan", rate_id: "rate_orphan" },
      ],
    })

    expect(result.succeeded).toEqual(["order_ok"])
    expect(result.failed).toEqual([
      {
        order_id: "order_orphan",
        error: "fulfillment creation failed",
        easypost_shipment_id: "bought_shp_orphan",
      },
    ])
    expect(calls.createLabelBatch).toEqual([[["bought_shp_ok"], "pdf"]])
    expect(result.label_pdf_url).toBe("batch.pdf")
  })

  it("one order's buyRate failure does not block the others in the same batch", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container } = buildContainer({
      orders: {
        order_fail: fulfillableOrder("order_fail"),
        order_ok: fulfillableOrder("order_ok"),
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
        { order_id: "order_fail", location_id: "sloc_1", shipment_id: "shp_a", rate_id: "rate_a" },
        { order_id: "order_ok", location_id: "sloc_1", shipment_id: "shp_b", rate_id: "rate_b" },
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
      orders: { order_1: fulfillableOrder("order_1") },
      buyRate: async () => ({ id: "shp_1", trackingCode: "trk_1", labelUrl: "url" }),
      createLabelBatch: async () => {
        throw new Error("EasyPost batch endpoint timed out")
      },
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_1", location_id: "sloc_1", shipment_id: "shp_1", rate_id: "rate_1" },
      ],
    })

    expect(result.succeeded).toEqual(["order_1"])
    expect(result.failed).toEqual([])
    expect(result.label_pdf_url).toBeUndefined()

    expect(calls.logs.some((l) => l.level === "warn")).toBe(true)
  })

  it("reports a non-Error throw as a readable reason instead of an empty one", async () => {
    const run = jest.fn().mockResolvedValue({})
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container } = buildContainer({
      orders: { order_1: fulfillableOrder("order_1") },
      buyRate: async () => {
        throw "carrier said no"
      },
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_1", location_id: "sloc_1", shipment_id: "shp_1", rate_id: "rate_1" },
      ],
    })

    expect(result.failed).toEqual([
      { order_id: "order_1", error: "carrier said no" },
    ])
  })

  it("reads the message off a plain serialized error object, as a failed nested workflow's run() rejects with", async () => {
    const run = jest
      .fn()
      .mockRejectedValue({ name: "Error", message: "EasyPost is unreachable" })
    createOrderFulfillmentWorkflow.mockReturnValue({ run })

    const { container } = buildContainer({
      orders: { order_1: fulfillableOrder("order_1") },
      buyRate: async () => ({ id: "shp_1", trackingCode: "trk_1" }),
    })

    const result = await runStep(container, {
      fulfillments: [
        { order_id: "order_1", location_id: "sloc_1", shipment_id: "shp_1", rate_id: "rate_1" },
      ],
    })

    expect(result.failed).toEqual([
      {
        order_id: "order_1",
        error: "EasyPost is unreachable",
        easypost_shipment_id: "shp_1",
      },
    ])
  })

  describe("pre-buy validation (no label is bought for a predictably unfulfillable order)", () => {
    const expectFailedWithoutBuying = async ({
      order,
      locationId = "sloc_1",
      inventoryLevels,
      reservations,
      error,
    }: {
      order: OrderFixture
      locationId?: string
      inventoryLevels?: { inventory_item_id: string; location_id: string }[]
      reservations?: { line_item_id: string }[]
      error: RegExp
    }) => {
      const run = jest.fn().mockResolvedValue({})
      createOrderFulfillmentWorkflow.mockReturnValue({ run })

      const { container, calls } = buildContainer({
        orders: { [order.id]: order, order_ok: fulfillableOrder("order_ok") },
        buyRate: async (shipmentId: string) => ({
          id: `bought_${shipmentId}`,
          trackingCode: "trk",
        }),
        inventoryLevels: inventoryLevels && [
          ...inventoryLevels,
          { inventory_item_id: "order_ok_iitem", location_id: "sloc_1" },
        ],
        reservations: reservations && [
          ...reservations,
          { line_item_id: "order_ok_item" },
        ],
      })

      const result = await runStep(container, {
        fulfillments: [
          { order_id: order.id, location_id: locationId, shipment_id: "shp_bad", rate_id: "rate_bad" },
          { order_id: "order_ok", location_id: "sloc_1", shipment_id: "shp_ok", rate_id: "rate_ok" },
        ],
      })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].order_id).toBe(order.id)
      expect(result.failed[0].error).toMatch(error)
      expect(result.failed[0].easypost_shipment_id).toBeUndefined()
      // Never bought for the bad order; the good order is unaffected.
      expect(calls.buyRate).toEqual([["shp_ok", "rate_ok"]])
      expect(result.succeeded).toEqual(["order_ok"])
    }

    it("when the chosen Ship From location doesn't stock one of the order's items", async () => {
      await expectFailedWithoutBuying({
        order: fulfillableOrder("order_1"),
        locationId: "sloc_elsewhere",
        error: /sloc_elsewhere doesn't stock item "order_1 item"/,
      })
    })

    it("when an item has no stock reservation", async () => {
      await expectFailedWithoutBuying({
        order: fulfillableOrder("order_1"),
        reservations: [],
        error: /no stock reservation found for item "order_1 item"/,
      })
    })

    it("when the order has no shipping method", async () => {
      await expectFailedWithoutBuying({
        order: fulfillableOrder("order_1", { shipping_methods: [] }),
        error: /no shipping method/,
      })
    })

    it("when the shipping method's shipping option no longer exists", async () => {
      await expectFailedWithoutBuying({
        order: fulfillableOrder("order_1", {
          shipping_methods: [{ shipping_option_id: "so_deleted" }],
        }),
        error: /so_deleted no longer exists/,
      })
    })

    it("when an item's shipping profile doesn't match the shipping option's", async () => {
      const order = fulfillableOrder("order_1")
      order.items[0].variant!.product = { shipping_profile: { id: "sp_other" } }
      await expectFailedWithoutBuying({ order, error: /shipping profile sp_other/ })
    })

    it("when the order has nothing left to fulfill", async () => {
      const order = fulfillableOrder("order_1")
      order.items[0].detail = { fulfilled_quantity: 1 }
      await expectFailedWithoutBuying({ order, error: /no unfulfilled items/ })
    })

    it("when the order is canceled", async () => {
      await expectFailedWithoutBuying({
        order: fulfillableOrder("order_1", { status: "canceled" }),
        error: /canceled/,
      })
    })

    it("when the order doesn't exist", async () => {
      const run = jest.fn().mockResolvedValue({})
      createOrderFulfillmentWorkflow.mockReturnValue({ run })
      const { container, calls } = buildContainer({
        orders: {},
        buyRate: async () => ({ id: "x", trackingCode: "t" }),
      })

      const result = await runStep(container, {
        fulfillments: [
          { order_id: "order_missing", location_id: "sloc_1", shipment_id: "shp", rate_id: "rate" },
        ],
      })

      expect(result.failed[0].error).toMatch(/not found/)
      expect(calls.buyRate).toEqual([])
    })

    it("resolves the location from the shipping option when no location_id is given", async () => {
      const run = jest.fn().mockResolvedValue({})
      createOrderFulfillmentWorkflow.mockReturnValue({ run })
      const { container, calls } = buildContainer({
        orders: { order_1: fulfillableOrder("order_1") },
        buyRate: async () => ({ id: "shp_1", trackingCode: "trk" }),
        inventoryLevels: [
          { inventory_item_id: "order_1_iitem", location_id: "sloc_option" },
        ],
      })

      const result = await runStep(container, {
        fulfillments: [
          { order_id: "order_1", shipment_id: "shp_q", rate_id: "rate_q" },
        ],
      })

      expect(result.succeeded).toEqual(["order_1"])
      expect(calls.buyRate).toEqual([["shp_q", "rate_q"]])
    })

    it("doesn't require inventory levels or reservations for items that don't manage inventory", async () => {
      const run = jest.fn().mockResolvedValue({})
      createOrderFulfillmentWorkflow.mockReturnValue({ run })
      const order = fulfillableOrder("order_1")
      order.items[0].variant!.manage_inventory = false
      const { container } = buildContainer({
        orders: { order_1: order },
        buyRate: async () => ({ id: "shp_1", trackingCode: "trk" }),
        inventoryLevels: [],
        reservations: [],
      })

      const result = await runStep(container, {
        fulfillments: [
          { order_id: "order_1", location_id: "sloc_anywhere", shipment_id: "shp_q", rate_id: "rate_q" },
        ],
      })

      expect(result.succeeded).toEqual(["order_1"])
    })
  })
})
