const mockFind = jest.fn()
const mockEmit = jest.fn()

jest.mock("../steps/find-drifted-base-price-offers", () => {
  const sdk = jest.requireActual("@medusajs/framework/workflows-sdk")
  return {
    findDriftedBasePriceOffersStep: sdk.createStep(
      "find-drifted-base-price-offers",
      async (input: any) => new sdk.StepResponse(await mockFind(input))
    ),
  }
})

jest.mock("@medusajs/medusa/core-flows", () => {
  const sdk = jest.requireActual("@medusajs/framework/workflows-sdk")
  return {
    emitEventStep: sdk.createStep("emit-event-step", async (input: any) => {
      await mockEmit(input)
      return new sdk.StepResponse(undefined)
    }),
  }
})

import { createMedusaContainer } from "@medusajs/framework/utils"
import { propagateBasePriceWorkflow } from "../propagate-base-price"
import { CHANNEL_OFFER_CHANGED_EVENT } from "../update-channel-offer"

function make() {
  const offers: any[] = [
    { id: "o1", variant_id: "v1", sales_channel_id: "sc_a", sync_state: "synced", last_error: null },
    { id: "o2", variant_id: "v1", sales_channel_id: "sc_b", sync_state: "failed", last_error: "boom" },
    { id: "o3", variant_id: "v1", sales_channel_id: "sc_c", sync_state: "synced", last_error: null },
  ]
  const service = {
    listForVariant: jest.fn(async (v: string) =>
      offers.filter((o) => o.variant_id === v).map((o) => ({ ...o }))
    ),
    markSync: jest.fn(async (v: string, c: string, r: any) => {
      const o = offers.find((o) => o.variant_id === v && o.sales_channel_id === c)
      o.sync_state = r.state
      o.last_error = r.state === "failed" ? r.error ?? null : null
    }),
    updateChannelOffers: jest.fn(async (patch: any) => {
      Object.assign(offers.find((o) => o.id === patch.id), patch)
    }),
  }
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  return { c, offers, service }
}

const drifted = {
  variant_id: "v1",
  drifted: [
    { channel_id: "sc_a", previous_sync_state: "synced" },
    { channel_id: "sc_b", previous_sync_state: "failed" },
  ],
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe("propagateBasePriceWorkflow", () => {
  it("emits one price event per drifted channel with force false", async () => {
    mockFind.mockResolvedValue(drifted)
    const t = make()
    const { result } = await propagateBasePriceWorkflow(t.c).run({
      input: { variant_id: "v1" },
    })
    expect(mockFind).toHaveBeenCalledWith({ variant_id: "v1" })
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: [
        { variant_id: "v1", sales_channel_id: "sc_a", kind: "price", force: false },
        { variant_id: "v1", sales_channel_id: "sc_b", kind: "price", force: false },
      ],
    })
    expect(t.offers.map((o) => o.sync_state)).toEqual(["pending", "pending", "synced"])
    expect(result).toEqual({ variant_id: "v1", channels: ["sc_a", "sc_b"] })
  })

  it("emits nothing when nothing drifted", async () => {
    mockFind.mockResolvedValue({ variant_id: "v1", drifted: [] })
    const t = make()
    const { result } = await propagateBasePriceWorkflow(t.c).run({
      input: { variant_id: "v1" },
    })
    // The step receives an empty array; emitEventStep maps it to zero
    // messages and returns before calling the event bus.
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith({ eventName: CHANNEL_OFFER_CHANGED_EVENT, data: [] })
    expect(t.service.markSync).not.toHaveBeenCalled()
    expect(result).toEqual({ variant_id: "v1", channels: [] })
  })

  it("a failure after marking triggers compensation", async () => {
    mockFind.mockResolvedValue(drifted)
    mockEmit.mockRejectedValue(new Error("event bus down"))
    const t = make()
    const { errors } = await propagateBasePriceWorkflow(t.c).run({
      input: { variant_id: "v1" },
      throwOnError: false,
    })
    expect(errors[0].error.message).toBe("event bus down")
    expect(t.offers.map((o) => [o.sync_state, o.last_error])).toEqual([
      ["synced", null],
      ["failed", "boom"],
      ["synced", null],
    ])
  })
})
