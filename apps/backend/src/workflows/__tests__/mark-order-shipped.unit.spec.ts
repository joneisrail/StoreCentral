const mockFulfill = jest.fn()
const mockShip = jest.fn()
const mockCancel = jest.fn()
const mockAcquire = jest.fn()
const mockRelease = jest.fn()
const mockLockCompensate = jest.fn()
const mockWarn = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  acquireLockStep: jest
    .requireActual("@medusajs/framework/workflows-sdk")
    .createStep(
      "acquire-lock-step",
      async (d: any) => {
        mockAcquire(d)
        return new (jest.requireActual("@medusajs/framework/workflows-sdk").StepResponse)(undefined, { k: d.key })
      },
      async () => {
        mockLockCompensate()
      }
    ),
  releaseLockStep: jest
    .requireActual("@medusajs/framework/workflows-sdk")
    .createStep("release-lock-step", async (d: any) => {
      mockRelease(d)
    }),
  createOrderFulfillmentWorkflow: () => ({ run: (i: any) => mockFulfill(i) }),
  createOrderShipmentWorkflow: () => ({ run: (i: any) => mockShip(i) }),
  cancelOrderFulfillmentWorkflow: () => ({ run: (i: any) => mockCancel(i) }),
}))

import { createMedusaContainer, MedusaError } from "@medusajs/framework/utils"
import { markOrderShippedWorkflow } from "../mark-order-shipped"

type Fixture = {
  order?: any
  store?: any
  options?: Record<string, any>
  manualOptions?: any[]
}

const makeContainer = (f: Fixture) => {
  const container = createMedusaContainer()
  const query = {
    graph: async ({ entity, filters }: any) => {
      if (entity === "order") return { data: f.order ? [f.order] : [] }
      if (entity === "store") return { data: [f.store ?? { id: "store_1", metadata: {} }] }
      if (entity === "shipping_option") {
        if (filters?.provider_id) return { data: f.manualOptions ?? [] }
        const o = f.options?.[filters?.id]
        return { data: o ? [o] : [] }
      }
      return { data: [] }
    },
  }
  container.register("query", { resolve: () => query } as any)
  container.register("logger", { resolve: () => ({ warn: mockWarn }) } as any)
  return container
}

const T = "2026-01-01T00:00:00Z"
const item = (id: string, quantity: number, fulfilled = 0) => ({ id, quantity, detail: { fulfilled_quantity: fulfilled } })
const order = (extra: any = {}) => ({
  id: "order_1",
  status: "pending",
  tags: [],
  items: [item("it_1", 2), item("it_2", 3, 1), item("it_3", 1, 1)],
  fulfillments: [],
  shipping_methods: [{ shipping_option_id: "so_1" }],
  ...extra,
})
const options = { so_1: { id: "so_1", service_zone: { fulfillment_set: { location: { id: "sloc_opt" } } } } }
const baseInput = { order_id: "order_1", carrier: "UPS", tracking_number: "1Z999", user_id: "user_1" }
const run = (container: any, input: any = {}) =>
  markOrderShippedWorkflow(container).run({ input: { ...baseInput, ...input } })

beforeEach(() => {
  jest.resetAllMocks()
  mockFulfill.mockResolvedValue({ result: { id: "ful_1" } })
  mockShip.mockResolvedValue({})
  mockCancel.mockResolvedValue({})
})

describe("markOrderShippedWorkflow", () => {
  it("fulfills every unfulfilled item, then ships it with the tracking number", async () => {
    const { result } = await run(makeContainer({ order: order(), options }), { tracking_url: "https://t.example/1" })
    expect(result).toEqual({ order_id: "order_1", fulfillment_id: "ful_1" })
    const items = [
      { id: "it_1", quantity: 2 },
      { id: "it_2", quantity: 2 },
    ]
    expect(mockFulfill).toHaveBeenCalledWith({
      input: expect.objectContaining({
        order_id: "order_1",
        items,
        location_id: "sloc_opt",
        shipping_option_id: "so_1",
        provider_id: "manual_manual",
        created_by: "user_1",
        metadata: { carrier: "UPS" },
        provider_data_override: { carrier: "UPS" },
      }),
    })
    expect(mockShip).toHaveBeenCalledWith({
      input: {
        order_id: "order_1",
        fulfillment_id: "ful_1",
        items,
        labels: [{ tracking_number: "1Z999", tracking_url: "https://t.example/1", label_url: "" }],
        no_notification: undefined,
        created_by: "user_1",
      },
    })
  })

  it("defaults tracking_url to an empty string and forwards no_notification", async () => {
    await run(makeContainer({ order: order(), options }), { no_notification: true })
    expect(mockShip.mock.calls[0][0].input.labels).toEqual([{ tracking_number: "1Z999", tracking_url: "", label_url: "" }])
    expect(mockShip.mock.calls[0][0].input.no_notification).toBe(true)
    expect(mockFulfill.mock.calls[0][0].input.no_notification).toBe(true)
  })

  it("records shipped_at in the fulfillment metadata only when given", async () => {
    await run(makeContainer({ order: order(), options }), { shipped_at: "2026-02-02T10:00:00.000Z" })
    expect(mockFulfill.mock.calls[0][0].input.metadata).toEqual({ carrier: "UPS", shipped_at: "2026-02-02T10:00:00.000Z" })
  })

  it("location: body, then store default, then the shipping option location", async () => {
    const store = { id: "s", metadata: { default_ship_from_location_id: "sloc_store" } }
    await run(makeContainer({ order: order(), options, store }), { location_id: "sloc_body" })
    expect(mockFulfill.mock.calls[0][0].input.location_id).toBe("sloc_body")
    await run(makeContainer({ order: order(), options, store }))
    expect(mockFulfill.mock.calls[1][0].input.location_id).toBe("sloc_store")
    await run(makeContainer({ order: order(), options }))
    expect(mockFulfill.mock.calls[2][0].input.location_id).toBe("sloc_opt")
  })

  it("without a shipping method it uses the manual shipping option", async () => {
    const manualOptions = [
      { id: "so_other", service_zone: { fulfillment_set: { location: { id: "sloc_x" } } } },
      { id: "so_man", service_zone: { fulfillment_set: { location: { id: "sloc_y" } } } },
    ]
    await run(makeContainer({ order: order({ shipping_methods: [] }), manualOptions }), { location_id: "sloc_y" })
    expect(mockFulfill.mock.calls[0][0].input).toEqual(
      expect.objectContaining({ shipping_option_id: "so_man", location_id: "sloc_y" })
    )
    await run(makeContainer({ order: order({ shipping_methods: [] }), manualOptions }))
    expect(mockFulfill.mock.calls[1][0].input).toEqual(
      expect.objectContaining({ shipping_option_id: "so_other", location_id: "sloc_x" })
    )
  })

  it("rejects when no shipping option or location can be found", async () => {
    await expect(run(makeContainer({ order: order({ shipping_methods: [] }) }))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    const noLoc = { so_1: { id: "so_1", service_zone: { fulfillment_set: {} } } }
    await expect(run(makeContainer({ order: order(), options: noLoc }))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: expect.stringMatching(/Ship From/),
    })
    expect(mockFulfill).not.toHaveBeenCalled()
  })

  it.each([
    ["canceled", { status: "canceled" }, /canceled/],
    ["on hold", { tags: [{ id: "t", value: "On hold" }] }, /on hold/],
    ["shipped", { fulfillments: [{ id: "f", shipped_at: T }] }, /already shipped/],
    ["delivered", { fulfillments: [{ id: "f", delivered_at: T }] }, /already shipped/],
    ["labeled", { fulfillments: [{ id: "f", packed_at: T, data: { easypost_shipment_id: "shp" } }] }, /Void the shipping label first/],
    ["fully fulfilled", { items: [item("it_1", 1, 1)] }, /no unfulfilled items/],
  ])("rejects a %s order", async (_n, extra, message) => {
    await expect(run(makeContainer({ order: order(extra), options }))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: expect.stringMatching(message),
    })
    expect(mockFulfill).not.toHaveBeenCalled()
  })

  it("ignores a canceled label fulfillment", async () => {
    const extra = { fulfillments: [{ id: "f", canceled_at: T, data: { easypost_shipment_id: "shp" } }] }
    const { result } = await run(makeContainer({ order: order(extra), options }))
    expect(result.fulfillment_id).toBe("ful_1")
  })

  it("rejects when fulfillments cannot be read, and an unknown order as not found", async () => {
    await expect(run(makeContainer({ order: order({ fulfillments: undefined }), options }))).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    await expect(run(makeContainer({}))).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
  })

  it("cancels the fulfillment and rethrows the original error when the shipment fails", async () => {
    mockShip.mockRejectedValue(new Error("shipment exploded"))
    await expect(run(makeContainer({ order: order(), options }))).rejects.toMatchObject({ message: "shipment exploded" })
    expect(mockCancel).toHaveBeenCalledWith({
      input: { order_id: "order_1", fulfillment_id: "ful_1", no_notification: true },
    })
  })

  it("still rethrows the original error when the compensation fails, and logs only ids", async () => {
    mockShip.mockRejectedValue(new Error("shipment exploded"))
    mockCancel.mockRejectedValue(new Error("cancel failed secret-123"))
    await expect(run(makeContainer({ order: order(), options }))).rejects.toMatchObject({ message: "shipment exploded" })
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const logged = String(mockWarn.mock.calls[0][0])
    expect(logged).toContain("order_1")
    expect(logged).toContain("ful_1")
    expect(logged).not.toMatch(/1Z999|UPS|secret-123|cancel failed/)
  })

  it("holds a per-order lock for the whole run and releases it", async () => {
    await run(makeContainer({ order: order(), options }))
    expect(mockAcquire).toHaveBeenCalledWith(expect.objectContaining({ key: "order_1" }))
    expect(mockRelease).toHaveBeenCalledWith({ key: "order_1" })
  })

  it("releases the lock through compensation when the run fails", async () => {
    await expect(run(makeContainer({ order: order({ status: "canceled" }), options }))).rejects.toBeDefined()
    expect(mockLockCompensate).toHaveBeenCalledTimes(1)
    expect(mockRelease).not.toHaveBeenCalled()
  })

  describe("shipping profile", () => {
    const withProfiles = (...profiles: (string | undefined)[]) =>
      order({
        shipping_methods: [],
        items: profiles.map((p, i) => ({
          ...item(`it_${i}`, 1),
          requires_shipping: true,
          variant: p ? { product: { shipping_profile: { id: p } } } : null,
        })),
      })
    const manualOptions = [
      { id: "so_a", shipping_profile_id: "sp_a", service_zone: { fulfillment_set: { location: { id: "sloc_1" } } } },
      { id: "so_b", shipping_profile_id: "sp_b", service_zone: { fulfillment_set: { location: { id: "sloc_1" } } } },
    ]

    it("picks the manual option that matches the items' profile", async () => {
      await run(makeContainer({ order: withProfiles("sp_b", "sp_b"), manualOptions }))
      expect(mockFulfill.mock.calls[0][0].input.shipping_option_id).toBe("so_b")
    })

    it("rejects with a clear message when no manual option matches", async () => {
      await expect(run(makeContainer({ order: withProfiles("sp_c"), manualOptions }))).rejects.toMatchObject({
        type: MedusaError.Types.NOT_ALLOWED,
        message: expect.stringMatching(/No manual shipping option matches this order's shipping profile/),
      })
      await expect(run(makeContainer({ order: withProfiles("sp_a", "sp_b"), manualOptions }))).rejects.toMatchObject({
        type: MedusaError.Types.NOT_ALLOWED,
      })
      expect(mockFulfill).not.toHaveBeenCalled()
    })

    it("custom items without a variant impose no profile", async () => {
      await run(makeContainer({ order: withProfiles(undefined), manualOptions }))
      expect(mockFulfill.mock.calls[0][0].input.shipping_option_id).toBe("so_a")
    })

    it("maps core's profile mismatch error to the same clear message", async () => {
      mockFulfill.mockRejectedValue(
        new MedusaError(MedusaError.Types.INVALID_DATA, "Shipping profile sp_x does not match the shipping profile of the order item it_1")
      )
      await expect(run(makeContainer({ order: order(), options }))).rejects.toMatchObject({
        type: MedusaError.Types.NOT_ALLOWED,
        message: expect.stringMatching(/No manual shipping option matches this order's shipping profile/),
      })
    })
  })

  it("does not cancel anything when the fulfillment itself fails", async () => {
    mockFulfill.mockRejectedValue(new Error("no stock"))
    await expect(run(makeContainer({ order: order(), options }))).rejects.toMatchObject({ message: "no stock" })
    expect(mockShip).not.toHaveBeenCalled()
    expect(mockCancel).not.toHaveBeenCalled()
  })
})
