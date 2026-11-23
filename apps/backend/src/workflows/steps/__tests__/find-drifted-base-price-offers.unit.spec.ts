import { createMedusaContainer } from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { fetchConnectedChannelIds } from "../../../api/admin/channel-offers/connections"
import { loadPushValues } from "../../../api/admin/channel-offers/query"
import {
  findDriftedBasePriceOffersStep,
  selectDriftedOffers,
} from "../find-drifted-base-price-offers"

jest.mock("../../../api/admin/channel-offers/connections", () => ({
  fetchConnectedChannelIds: jest.fn(),
}))
jest.mock("../../../api/admin/channel-offers/query", () => ({
  loadPushValues: jest.fn(),
}))

const offer = (o: Partial<{ channel_id: string; price: number | null; last_synced_price: number | null; sync_state: string }> = {}) => ({
  channel_id: "sc_a",
  price: null,
  last_synced_price: 10,
  sync_state: "synced",
  ...o,
})

describe("selectDriftedOffers", () => {
  const connected = new Set(["sc_a"])

  it("skips offers with an explicit price", () => {
    expect(selectDriftedOffers([offer({ price: 5 })], { sc_a: 20 }, connected)).toEqual([])
  })

  it("skips channels without a connection", () => {
    expect(selectDriftedOffers([offer({ channel_id: "sc_x" })], { sc_x: 20 }, connected)).toEqual([])
  })

  it("selects when last_synced_price is null", () => {
    expect(
      selectDriftedOffers([offer({ last_synced_price: null, sync_state: "pending" })], { sc_a: 10 }, connected)
    ).toEqual([{ channel_id: "sc_a", previous_sync_state: "pending" }])
  })

  it("selects when difference is 0.005 or more", () => {
    expect(selectDriftedOffers([offer({ last_synced_price: 10 })], { sc_a: 10.01 }, connected)).toEqual([
      { channel_id: "sc_a", previous_sync_state: "synced" },
    ])
    expect(selectDriftedOffers([offer({ last_synced_price: 10 })], { sc_a: 9.99 }, connected)).toHaveLength(1)
  })

  it("skips when difference is under 0.005", () => {
    expect(selectDriftedOffers([offer({ last_synced_price: 10 })], { sc_a: 10.004 }, connected)).toEqual([])
  })

  it("empty inputs", () => {
    expect(selectDriftedOffers([], {}, new Set())).toEqual([])
  })
})

const wf = createWorkflow("test-find-drifted-base-price-offers", function (input: any) {
  return new WorkflowResponse(findDriftedBasePriceOffersStep(transform({ input }, ({ input }) => input)))
})

function make(rows: any[]) {
  const service = { listForVariant: jest.fn(async () => rows) }
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  c.register("query", { resolve: () => ({ graph: jest.fn() }) } as any)
  return { c, service }
}

const row = (o: any) => ({ sales_channel_id: "sc_a", price: null, last_synced_price: 10, sync_state: "synced", ...o })

describe("findDriftedBasePriceOffersStep", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns drifted channels with previous sync state", async () => {
    ;(fetchConnectedChannelIds as jest.Mock).mockResolvedValue(new Set(["sc_a", "sc_b"]))
    ;(loadPushValues as jest.Mock).mockImplementation(async (_d: any, _v: string, ch: string) => ({
      price: null,
      effective_price: ch === "sc_a" ? 12 : 10,
      stock: 0,
    }))
    const { c } = make([
      row({ sales_channel_id: "sc_a", sync_state: "failed", price: "" }),
      row({ sales_channel_id: "sc_b" }),
      row({ sales_channel_id: "sc_c" }),
      row({ sales_channel_id: "sc_a2", price: 7 }),
    ].map((r) => (r.price === "" ? { ...r, price: null } : r)))
    const { result } = await wf(c).run({ input: { variant_id: "v1" } })
    expect(result).toEqual({
      variant_id: "v1",
      drifted: [{ channel_id: "sc_a", previous_sync_state: "failed" }],
    })
    expect(loadPushValues).toHaveBeenCalledTimes(2)
    expect(fetchConnectedChannelIds).toHaveBeenCalledTimes(1)
  })

  it("does nothing for a variant with no offers", async () => {
    ;(fetchConnectedChannelIds as jest.Mock).mockResolvedValue(new Set(["sc_a"]))
    const { c } = make([])
    const { result } = await wf(c).run({ input: { variant_id: "v1" } })
    expect(result).toEqual({ variant_id: "v1", drifted: [] })
    expect(loadPushValues).not.toHaveBeenCalled()
  })

  it("propagates a connection lookup failure", async () => {
    ;(fetchConnectedChannelIds as jest.Mock).mockRejectedValue(new Error("hub down"))
    const { c } = make([row({})])
    await expect(wf(c).run({ input: { variant_id: "v1" } })).rejects.toMatchObject({ message: "hub down" })
  })
})
