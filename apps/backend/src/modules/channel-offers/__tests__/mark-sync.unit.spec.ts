import ChannelOffersModuleService from "../service"

// markSync's derivation only, with the generated list/update methods stubbed.
function make(row: Record<string, unknown>) {
  const svc: any = Object.create(ChannelOffersModuleService.prototype)
  const current: any = { id: "o1", stock: 5, last_synced_stock: 5, ...row }
  svc.listChannelOffers = jest.fn(async () => [current])
  svc.updateChannelOffers = jest.fn(async (patch: any) => Object.assign(current, patch))
  return { svc: svc as ChannelOffersModuleService, current }
}

describe("markSync", () => {
  it("keeps a null-price offer pending after a stock-only push when the effective price was never pushed", async () => {
    const t = make({ price: null, last_synced_price: 10, sync_state: "pending" })
    await t.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, effectivePrice: 12 })
    expect(t.current.sync_state).toBe("pending")
    expect(t.current.last_synced_stock).toBe(5)
    expect(t.current.last_synced_price).toBe(10)
  })

  it("keeps it pending when last_synced_price is null and an effective price is given", async () => {
    const t = make({ price: null, last_synced_price: null, sync_state: "pending" })
    await t.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, effectivePrice: 12 })
    expect(t.current.sync_state).toBe("pending")
  })

  it("marks a null-price offer synced when the effective price equals the last pushed price", async () => {
    const t = make({ price: null, last_synced_price: 12, sync_state: "pending" })
    await t.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, effectivePrice: 12.004 })
    expect(t.current.sync_state).toBe("synced")
  })

  it("marks it synced when the push carried the effective price", async () => {
    const t = make({ price: null, last_synced_price: 10, sync_state: "pending" })
    await t.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, price: 12, effectivePrice: 12 })
    expect(t.current.sync_state).toBe("synced")
    expect(t.current.last_synced_price).toBe(12)
  })

  it("without effectivePrice a null-price offer keeps today's rule (price counts as synced)", async () => {
    const t = make({ price: null, last_synced_price: 10, sync_state: "pending" })
    await t.svc.markSync("v1", "sc_a", { state: "synced", stock: 5 })
    expect(t.current.sync_state).toBe("synced")
  })

  it("explicit-price offers keep their rule and ignore effectivePrice", async () => {
    const a = make({ price: 15, last_synced_price: 15, sync_state: "pending" })
    await a.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, effectivePrice: 99 })
    expect(a.current.sync_state).toBe("synced")
    const b = make({ price: 15, last_synced_price: 14, sync_state: "pending" })
    await b.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, effectivePrice: 15 })
    expect(b.current.sync_state).toBe("pending")
  })

  it("stock mismatch still keeps it pending", async () => {
    const t = make({ price: null, last_synced_price: 12, stock: 6, sync_state: "pending" })
    await t.svc.markSync("v1", "sc_a", { state: "synced", stock: 5, effectivePrice: 12 })
    expect(t.current.sync_state).toBe("pending")
  })
})
