import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import sellerHubSyncHandler, { config, resolveOrderIdForFulfillment } from "../seller-hub-sync"

const mockGraph = jest.fn()
const mockListOffers = jest.fn()
const container: any = {
  resolve: (key: string) =>
    key === CHANNEL_OFFERS_MODULE ? { listChannelOffers: mockListOffers } : { graph: mockGraph },
}
const mockFetch = jest.fn()
let errSpy: jest.SpyInstance

const run = (name: string, data: any) => sellerHubSyncHandler({ event: { name, data }, container } as any)

beforeEach(() => {
  mockGraph.mockReset()
  mockListOffers.mockReset().mockResolvedValue([])
  mockFetch.mockReset().mockResolvedValue({ ok: true, status: 200 })
  ;(global as any).fetch = mockFetch
  process.env.SELLER_HUB_WEBHOOK_URL = "http://hub.test"
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

const logged = () => JSON.stringify(errSpy.mock.calls.map((c) => c.map((a) => (a instanceof Error ? a.message : a))))

describe("seller-hub-sync subscriber", () => {
  it("subscribes to shipment.created as well", () => {
    expect(config.event).toEqual([
      "inventory-level.updated",
      "product-variant.updated",
      "shipment.created",
      "channel-offer.changed",
    ])
  })

  it("forwards shipment.created with order_id and no_notification", async () => {
    mockGraph.mockResolvedValue({ data: [{ order_id: "order_1" }] })
    await run("shipment.created", { id: "ful_1", no_notification: true })
    expect(mockGraph).toHaveBeenCalledWith({
      entity: "order_fulfillment",
      fields: ["order_id"],
      filters: { fulfillment_id: "ful_1" },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("http://hub.test/webhooks/medusa")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      event: "shipment.created",
      data: { id: "ful_1", order_id: "order_1", no_notification: true },
    })
  })

  it("no_notification defaults to false", async () => {
    mockGraph.mockResolvedValue({ data: [{ order_id: "order_1" }] })
    await run("shipment.created", { id: "ful_1" })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).data.no_notification).toBe(false)
  })

  it("logs and drops when the order cannot be resolved, without throwing and without calling fetch", async () => {
    mockGraph.mockResolvedValue({ data: [] })
    await expect(run("shipment.created", { id: "ful_1" })).resolves.toBeUndefined()
    mockGraph.mockRejectedValue(new Error("db down"))
    await expect(run("shipment.created", { id: "ful_1" })).resolves.toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledTimes(2)
    expect(logged()).toContain("shipment.created")
  })

  const bodies = () => mockFetch.mock.calls.map((c) => JSON.parse(c[1].body))

  describe("channel-offer.changed", () => {
    const base = { variant_id: "v1", sales_channel_id: "sc1" }

    it("forwards variant, channel, kind and force=false by default", async () => {
      await run("channel-offer.changed", { ...base, kind: "stock" })
      expect(bodies()).toEqual([
        { event: "channel-offer.changed", data: { ...base, kind: "stock", force: false } },
      ])
      expect(mockGraph).not.toHaveBeenCalled()
      expect(mockListOffers).not.toHaveBeenCalled()
    })

    it("forwards force=true from the sync route and manual=true from manual edits", async () => {
      await run("channel-offer.changed", { ...base, kind: "both", force: true })
      await run("channel-offer.changed", { ...base, kind: "price", manual: true })
      expect(bodies()).toEqual([
        { event: "channel-offer.changed", data: { ...base, kind: "both", force: true } },
        { event: "channel-offer.changed", data: { ...base, kind: "price", force: false, manual: true } },
      ])
    })

    it("forwards price events too (seller-hub applies auto_sync_price) and ignores extra fields", async () => {
      await run("channel-offer.changed", { ...base, kind: "price", secret: "x" })
      expect(bodies()[0].data).toEqual({ ...base, kind: "price", force: false })
    })

    it("drops a malformed event without calling fetch or throwing", async () => {
      await expect(run("channel-offer.changed", { variant_id: "v1", kind: "stock" })).resolves.toBeUndefined()
      await expect(run("channel-offer.changed", { ...base, kind: "weird" })).resolves.toBeUndefined()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(errSpy).toHaveBeenCalledTimes(2)
    })

    it("non-2xx and network errors never throw", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      await expect(run("channel-offer.changed", { ...base, kind: "stock" })).resolves.toBeUndefined()
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))
      await expect(run("channel-offer.changed", { ...base, kind: "stock" })).resolves.toBeUndefined()
      expect(errSpy).toHaveBeenCalledTimes(2)
      expect(logged()).not.toContain("ECONNREFUSED")
    })
  })

  describe("legacy variant-level forwarding", () => {
    it("product-variant.updated is forwarded when the variant has no offer rows", async () => {
      await run("product-variant.updated", { id: "variant_1" })
      expect(mockListOffers).toHaveBeenCalledWith({ variant_id: ["variant_1"] }, expect.anything())
      expect(bodies()).toEqual([{ event: "product-variant.updated", data: { id: "variant_1" } }])
    })

    it("product-variant.updated is dropped when the variant has offer rows", async () => {
      mockListOffers.mockResolvedValue([{ variant_id: "variant_1" }])
      await run("product-variant.updated", { id: "variant_1" })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    const levelGraph = (variantIds: string[]) =>
      mockGraph.mockImplementation(async (a: any) =>
        a.entity === "inventory_level"
          ? { data: [{ id: "ilev_1", inventory_item_id: "iitem_1" }] }
          : { data: [{ id: "iitem_1", variants: variantIds.map((id) => ({ id })) }] }
      )

    it("inventory-level.updated resolves level -> item -> variants and forwards when none has offers", async () => {
      levelGraph(["va", "vb"])
      await run("inventory-level.updated", { id: "ilev_1" })
      expect(mockListOffers).toHaveBeenCalledWith({ variant_id: ["va", "vb"] }, expect.anything())
      expect(bodies()).toEqual([{ event: "inventory-level.updated", data: { id: "ilev_1" } }])
    })

    it("inventory-level.updated is dropped when every variant has offer rows", async () => {
      levelGraph(["va", "vb"])
      mockListOffers.mockResolvedValue([{ variant_id: "va" }, { variant_id: "vb" }])
      await run("inventory-level.updated", { id: "ilev_1" })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("inventory-level.updated is forwarded once when any variant has no offer rows", async () => {
      levelGraph(["va", "vb"])
      mockListOffers.mockResolvedValue([{ variant_id: "va" }])
      await run("inventory-level.updated", { id: "ilev_1" })
      expect(bodies()).toEqual([{ event: "inventory-level.updated", data: { id: "ilev_1" } }])
    })

    it("inventory-level.updated with no resolvable variants is forwarded (legacy behaviour)", async () => {
      mockGraph.mockResolvedValue({ data: [] })
      await run("inventory-level.updated", { id: "ilev_1" })
      expect(bodies()).toEqual([{ event: "inventory-level.updated", data: { id: "ilev_1" } }])
    })

    it("a failing lookup falls back to forwarding and never throws", async () => {
      mockListOffers.mockRejectedValue(new Error("db down"))
      await expect(run("product-variant.updated", { id: "variant_1" })).resolves.toBeUndefined()
      mockGraph.mockRejectedValue(new Error("db down"))
      await expect(run("inventory-level.updated", { id: "ilev_1" })).resolves.toBeUndefined()
      expect(bodies().map((b) => b.event)).toEqual(["product-variant.updated", "inventory-level.updated"])
      expect(errSpy).toHaveBeenCalledTimes(2)
      expect(logged()).not.toContain("db down")
    })
  })

  it("missing SELLER_HUB_WEBHOOK_URL logs and returns", async () => {
    delete process.env.SELLER_HUB_WEBHOOK_URL
    await expect(run("shipment.created", { id: "ful_1" })).resolves.toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(logged()).toContain("shipment.created")
  })

  it("non-2xx and network errors never throw", async () => {
    mockGraph.mockResolvedValue({ data: [{ order_id: "order_1" }] })
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(run("shipment.created", { id: "ful_1" })).resolves.toBeUndefined()
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    await expect(run("shipment.created", { id: "ful_1" })).resolves.toBeUndefined()
    await expect(run("inventory-level.updated", { id: "i" })).resolves.toBeUndefined()
    // exactly one log for the 500, one for the network error, none for the success
    expect(errSpy.mock.calls).toEqual([
      ['[seller-hub-sync] webhook receiver responded with status 500 for event "shipment.created"'],
      ['[seller-hub-sync] failed to forward event "shipment.created" to Seller Hub: Error'],
    ])
    expect(logged()).not.toContain("ECONNREFUSED")
  })

  it("resolveOrderIdForFulfillment queries the order_fulfillment link", async () => {
    mockGraph.mockResolvedValue({ data: [{ order_id: "order_9" }] })
    await expect(resolveOrderIdForFulfillment({ graph: mockGraph }, "ful_9")).resolves.toBe("order_9")
    mockGraph.mockResolvedValue({ data: [] })
    await expect(resolveOrderIdForFulfillment({ graph: mockGraph }, "ful_9")).resolves.toBeUndefined()
  })

  it("no tracking data or request body in logs", async () => {
    mockGraph.mockResolvedValue({ data: [{ order_id: "order_1" }] })
    const data = { id: "ful_1", tracking_number: "1Z999SECRET", labels: [{ tracking_number: "1Z999SECRET" }] }
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 })
    await run("shipment.created", data)
    mockFetch.mockRejectedValueOnce(new Error("boom"))
    await run("shipment.created", data)
    mockGraph.mockResolvedValue({ data: [] })
    await run("shipment.created", data)
    const out = logged()
    expect(out).not.toContain("1Z999SECRET")
    expect(out).not.toContain("tracking")
    expect(out).not.toContain("no_notification")
  })
})
