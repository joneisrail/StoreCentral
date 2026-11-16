import { readShareStockSetting } from "../settings"

const containerWith = (stores: any[] | Error) =>
  ({
    resolve: () => ({
      graph: async () => {
        if (stores instanceof Error) throw stores
        return { data: stores }
      },
    }),
  }) as any

describe("readShareStockSetting", () => {
  it("defaults to false when no store or no metadata", async () => {
    expect(await readShareStockSetting(containerWith([]))).toBe(false)
    expect(await readShareStockSetting(containerWith([{ id: "s" }]))).toBe(false)
    expect(
      await readShareStockSetting(containerWith([{ id: "s", metadata: {} }]))
    ).toBe(false)
  })

  it("returns true only for boolean true", async () => {
    const t = containerWith([{ metadata: { share_stock_after_sale: true } }])
    expect(await readShareStockSetting(t)).toBe(true)
    for (const v of ["true", 1, null, false]) {
      const c = containerWith([{ metadata: { share_stock_after_sale: v } }])
      expect(await readShareStockSetting(c)).toBe(false)
    }
  })

  it("propagates query errors", async () => {
    await expect(
      readShareStockSetting(containerWith(new Error("db down")))
    ).rejects.toThrow("db down")
  })
})
