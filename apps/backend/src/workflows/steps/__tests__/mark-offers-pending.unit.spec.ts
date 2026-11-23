import { createMedusaContainer } from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  markOffersPendingStep,
  restorePreviousSyncStates,
} from "../mark-offers-pending"

const wf = createWorkflow("test-mark-offers-pending", function (input: any) {
  const r = markOffersPendingStep(transform({ input }, ({ input }) => input))
  return new WorkflowResponse(r)
})

type Row = {
  id: string
  sales_channel_id: string
  sync_state: "synced" | "pending" | "failed"
  last_error: string | null
  price: number | null
  stock: number
  last_synced_price: number | null
  last_synced_stock: number | null
  last_synced_at: string | null
}

const row = (id: string, channel: string, extra: Partial<Row> = {}): Row => ({
  id,
  sales_channel_id: channel,
  sync_state: "synced",
  last_error: null,
  price: null,
  stock: 3,
  last_synced_price: 10,
  last_synced_stock: 3,
  last_synced_at: "2026-11-01T00:00:00Z",
  ...extra,
})

function make(rows: Row[]) {
  const offers = rows.map((r) => ({ variant_id: "v1", ...r }))
  const service = {
    listForVariant: jest.fn(async (v: string) =>
      offers.filter((o) => o.variant_id === v).map((o) => ({ ...o }))
    ),
    markSync: jest.fn(async (v: string, c: string, r: any) => {
      const o = offers.find((o) => o.variant_id === v && o.sales_channel_id === c)!
      if (r.state === "pending") {
        o.sync_state = "pending"
        o.last_error = null
      } else if (r.state === "failed") {
        o.sync_state = "failed"
        o.last_error = r.error ?? null
      } else {
        throw new Error("synced must not be restored through markSync")
      }
    }),
    updateChannelOffers: jest.fn(async (patch: any) => {
      const o = offers.find((o) => o.id === patch.id)!
      Object.assign(o, patch)
    }),
  }
  const c = createMedusaContainer()
  c.register("channelOffers", { resolve: () => service } as any)
  return { c, offers, service }
}

const snapshot = (offers: any[]) =>
  offers.map(({ sync_state, last_error, ...rest }) => rest)

describe("markOffersPendingStep", () => {
  it("marks only drifted channels pending", async () => {
    const t = make([
      row("o1", "sc_a"),
      row("o2", "sc_b", { sync_state: "failed", last_error: "boom" }),
      row("o3", "sc_c"),
    ])
    const before = snapshot(t.offers)
    const { result } = await wf(t.c).run({
      input: {
        variant_id: "v1",
        drifted: [
          { channel_id: "sc_a", previous_sync_state: "synced" },
          { channel_id: "sc_b", previous_sync_state: "failed" },
        ],
      },
    })
    expect(t.offers.map((o) => [o.sales_channel_id, o.sync_state, o.last_error])).toEqual([
      ["sc_a", "pending", null],
      ["sc_b", "pending", null],
      ["sc_c", "synced", null],
    ])
    expect(t.service.markSync).toHaveBeenCalledTimes(2)
    expect(t.service.markSync).toHaveBeenCalledWith("v1", "sc_a", { state: "pending" })
    expect(t.service.markSync).toHaveBeenCalledWith("v1", "sc_b", { state: "pending" })
    // price, stock and last_synced_* are never touched
    expect(snapshot(t.offers)).toEqual(before)
    expect(result).toEqual({ variant_id: "v1", marked: ["sc_a", "sc_b"] })
  })

  it("does nothing for an empty drift list", async () => {
    const t = make([row("o1", "sc_a")])
    await wf(t.c).run({ input: { variant_id: "v1", drifted: [] } })
    expect(t.service.markSync).not.toHaveBeenCalled()
    expect(t.offers[0].sync_state).toBe("synced")
  })

  it("is idempotent when already pending", async () => {
    const t = make([row("o1", "sc_a", { sync_state: "pending" })])
    const before = JSON.stringify(t.offers)
    const { result } = await wf(t.c).run({
      input: {
        variant_id: "v1",
        drifted: [{ channel_id: "sc_a", previous_sync_state: "pending" }],
      },
    })
    expect(t.service.markSync).not.toHaveBeenCalled()
    expect(t.service.updateChannelOffers).not.toHaveBeenCalled()
    expect(JSON.stringify(t.offers)).toBe(before)
    expect(result).toEqual({ variant_id: "v1", marked: [] })
  })

  it("compensation restores previous states", async () => {
    const t = make([
      row("o1", "sc_a"),
      row("o2", "sc_b", { sync_state: "failed", last_error: "boom" }),
      row("o3", "sc_c", { sync_state: "pending" }),
    ])
    const before = JSON.parse(JSON.stringify(t.offers))
    const previous = [
      { variant_id: "v1", channel_id: "sc_a", id: "o1", sync_state: "synced" as const, last_error: null },
      { variant_id: "v1", channel_id: "sc_b", id: "o2", sync_state: "failed" as const, last_error: "boom" },
    ]
    // simulate the forward step's effect
    for (const o of t.offers.slice(0, 2)) {
      o.sync_state = "pending"
      o.last_error = null
    }
    await restorePreviousSyncStates(t.c, previous)
    expect(t.offers).toEqual(before)
    // synced is restored directly (markSync would re-derive it), only sync_state is written
    expect(t.service.updateChannelOffers).toHaveBeenCalledWith({ id: "o1", sync_state: "synced" })
    expect(t.service.markSync).toHaveBeenCalledWith("v1", "sc_b", { state: "failed", error: "boom" })
    await expect(restorePreviousSyncStates(t.c, undefined)).resolves.toBeUndefined()
  })
})
