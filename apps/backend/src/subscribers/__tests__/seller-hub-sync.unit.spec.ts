import sellerHubSyncHandler, { config } from "../seller-hub-sync"

const mockGraph = jest.fn()
const container: any = { resolve: () => ({ graph: mockGraph }) }
const mockFetch = jest.fn()
let errSpy: jest.SpyInstance

const run = (name: string, data: any) => sellerHubSyncHandler({ event: { name, data }, container } as any)

beforeEach(() => {
  mockGraph.mockReset()
  mockFetch.mockReset().mockResolvedValue({ ok: true, status: 200 })
  ;(global as any).fetch = mockFetch
  process.env.SELLER_HUB_WEBHOOK_URL = "http://hub.test"
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

const logged = () => JSON.stringify(errSpy.mock.calls.map((c) => c.map((a) => (a instanceof Error ? a.message : a))))

describe("seller-hub-sync subscriber", () => {
  it("subscribes to shipment.created as well", () => {
    expect(config.event).toEqual(["inventory-level.updated", "product-variant.updated", "shipment.created"])
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

  it("inventory and price events are forwarded unchanged", async () => {
    await run("inventory-level.updated", { id: "ilev_1" })
    await run("product-variant.updated", { id: "variant_1" })
    expect(mockGraph).not.toHaveBeenCalled()
    expect(mockFetch.mock.calls.map((c) => JSON.parse(c[1].body))).toEqual([
      { event: "inventory-level.updated", data: { id: "ilev_1" } },
      { event: "product-variant.updated", data: { id: "variant_1" } },
    ])
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
    expect(errSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
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
