import ensure, { config as ensureConfig } from "../channel-offers-ensure"
import trim, { config as trimConfig } from "../channel-stock-trim"

const mockEnsureRun = jest.fn()
const mockTrimRun = jest.fn()
jest.mock("../../workflows/ensure-channel-offers", () => ({
  ensureChannelOffersWorkflow: () => ({ run: (...a: unknown[]) => mockEnsureRun(...a) }),
}))
jest.mock("../../workflows/trim-channel-stock", () => ({
  trimChannelStockWorkflow: () => ({ run: (...a: unknown[]) => mockTrimRun(...a) }),
}))

const mockWarn = jest.fn()
const graph = jest.fn()
const container: any = {
  resolve: (k: string) => (k === "query" ? { graph } : { warn: mockWarn }),
}

beforeEach(() => {
  mockEnsureRun.mockReset().mockResolvedValue({})
  mockTrimRun.mockReset().mockResolvedValue({})
  mockWarn.mockReset()
  graph.mockReset()
})

describe("channel-offers-ensure subscriber", () => {
  it("listens to product-variant.created and sales-channel.created", () => {
    expect(ensureConfig.event).toEqual(["product-variant.created", "sales-channel.created"])
  })
  it("variant event ensures that variant", async () => {
    await ensure({ event: { name: "product-variant.created", data: { id: "v1" } }, container } as any)
    expect(mockEnsureRun).toHaveBeenCalledWith({ input: { variant_id: "v1" } })
  })
  it("channel event ensures that channel", async () => {
    await ensure({ event: { name: "sales-channel.created", data: { id: "sc1" } }, container } as any)
    expect(mockEnsureRun).toHaveBeenCalledWith({ input: { sales_channel_id: "sc1" } })
  })
  it("never throws and logs only the id", async () => {
    mockEnsureRun.mockRejectedValue(new Error("secret"))
    await expect(
      ensure({ event: { name: "product-variant.created", data: { id: "v1" } }, container } as any)
    ).resolves.toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith("Failed to ensure channel offers for variant v1")
  })
})

describe("channel-stock-trim subscriber", () => {
  it("listens to inventory-level.updated", () => {
    expect(trimConfig.event).toBe("inventory-level.updated")
  })
  it("resolves the level's item and trims every linked variant", async () => {
    graph
      .mockResolvedValueOnce({ data: [{ id: "il1", inventory_item_id: "ii1" }] })
      .mockResolvedValueOnce({ data: [{ id: "ii1", variants: [{ id: "v1" }, { id: "v2" }] }] })
    await trim({ event: { name: "inventory-level.updated", data: { id: "il1" } }, container } as any)
    expect(mockTrimRun).toHaveBeenCalledTimes(2)
    expect(mockTrimRun).toHaveBeenCalledWith({ input: { variant_id: "v1" } })
    expect(mockTrimRun).toHaveBeenCalledWith({ input: { variant_id: "v2" } })
  })
  it("one failing variant does not stop the others and nothing throws", async () => {
    graph
      .mockResolvedValueOnce({ data: [{ id: "il1", inventory_item_id: "ii1" }] })
      .mockResolvedValueOnce({ data: [{ id: "ii1", variants: [{ id: "v1" }, { id: "v2" }] }] })
    mockTrimRun.mockRejectedValueOnce(new Error("secret"))
    await expect(
      trim({ event: { name: "inventory-level.updated", data: { id: "il1" } }, container } as any)
    ).resolves.toBeUndefined()
    expect(mockTrimRun).toHaveBeenCalledTimes(2)
    expect(mockWarn).toHaveBeenCalledWith("Failed to trim channel stock for variant v1")
  })
  it("never throws when the lookup fails", async () => {
    graph.mockRejectedValue(new Error("secret"))
    await expect(
      trim({ event: { name: "inventory-level.updated", data: { id: "il1" } }, container } as any)
    ).resolves.toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith("Failed to trim channel stock for inventory level il1")
  })
})
