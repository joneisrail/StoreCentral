import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import ChannelOffersModuleService from "../service"

moduleIntegrationTestRunner<ChannelOffersModuleService>({
  moduleName: "channelOffers",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("ChannelOffersModuleService", () => {
      it("ensureOffers is idempotent and never touches existing rows", async () => {
        await service.ensureOffers(["variant_1"], ["sc_a"])
        await service.setStocks("variant_1", { sc_a: 5 })
        await service.setPrice("variant_1", "sc_a", 12.5)
        await service.ensureOffers(["variant_1"], ["sc_a"])
        const rows = await service.listForVariant("variant_1")
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          variant_id: "variant_1",
          sales_channel_id: "sc_a",
          stock: 5,
          price: 12.5,
          sync_state: "pending",
        })
      })

      it("new rows start at stock 0, price null", async () => {
        await service.ensureOffers(["variant_2"], ["sc_a"])
        const [row] = await service.listForVariant("variant_2")
        expect(row.stock).toBe(0)
        expect(row.price).toBeNull()
        expect(row.last_synced_price).toBeNull()
        expect(row.last_synced_stock).toBeNull()
        expect(row.last_synced_at).toBeNull()
        expect(row.last_error).toBeNull()
      })

      it("listForVariant orders by channel creation order", async () => {
        await service.ensureOffers(["variant_3"], ["sc_z"])
        await service.ensureOffers(["variant_3"], ["sc_a", "sc_m"])
        const rows = await service.listForVariant("variant_3")
        expect(rows.map((r) => r.sales_channel_id)).toEqual([
          "sc_z",
          "sc_a",
          "sc_m",
        ])
        expect(rows[0].channel_order).toBeLessThan(rows[1].channel_order)
        expect(rows[1].channel_order).toBeLessThan(rows[2].channel_order)
      })

      it("applyMovement returns false for a repeated (kind, ref, variant, channel)", async () => {
        const m = {
          kind: "order" as const,
          variant_id: "variant_4",
          sales_channel_id: "sc_a",
          delta: -2,
          ref: "line_1",
        }
        expect(await service.applyMovement(m)).toBe(true)
        expect(await service.applyMovement(m)).toBe(false)
        expect(
          await service.applyMovement({ ...m, sales_channel_id: "sc_b" })
        ).toBe(true)
        const rows = await service.listChannelStockMovements({
          variant_id: "variant_4",
        })
        expect(rows).toHaveLength(2)
      })

      it("stores prices as exact decimals and returns plain numbers", async () => {
        await service.ensureOffers(["variant_6"], ["sc_a"])
        await service.setPrice("variant_6", "sc_a", 89.99)
        await service.markSync("variant_6", "sc_a", {
          state: "synced",
          price: 1234567.89,
        })
        const [row] = await service.listForVariant("variant_6")
        expect(typeof row.price).toBe("number")
        expect(row.price).toBe(89.99)
        expect(typeof row.last_synced_price).toBe("number")
        expect(row.last_synced_price).toBe(1234567.89)
        await service.setPrice("variant_6", "sc_a", null)
        const [cleared] = await service.listForVariant("variant_6")
        expect(cleared.price).toBeNull()
      })

      it("concurrent identical applyMovement calls: one true, one false", async () => {
        const m = {
          kind: "order" as const,
          variant_id: "variant_7",
          sales_channel_id: "sc_a",
          delta: -1,
          ref: "line_race",
        }
        const results = await Promise.all([
          service.applyMovement(m),
          service.applyMovement(m),
        ])
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(results.filter((r) => !r)).toHaveLength(1)
      })

      it("concurrent ensureOffers calls leave one row per (variant, channel)", async () => {
        await Promise.all([
          service.ensureOffers(["variant_8", "variant_9"], ["sc_a", "sc_b"]),
          service.ensureOffers(["variant_9", "variant_10"], ["sc_b", "sc_c"]),
        ])
        for (const [v, n] of [
          ["variant_8", 2],
          ["variant_9", 3],
          ["variant_10", 2],
        ] as const) {
          const rows = await service.listForVariant(v)
          expect(rows).toHaveLength(n)
          expect(new Set(rows.map((r) => r.sales_channel_id)).size).toBe(n)
        }
      })

      it("setStocks and setPrice reject negative values", async () => {
        await service.ensureOffers(["variant_11"], ["sc_a"])
        await expect(
          service.setStocks("variant_11", { sc_a: -1 })
        ).rejects.toThrow(/must be >= 0/)
        await expect(
          service.setPrice("variant_11", "sc_a", -0.01)
        ).rejects.toThrow(/must be >= 0/)
        const [row] = await service.listForVariant("variant_11")
        expect(row.stock).toBe(0)
        expect(row.price).toBeNull()
      })

      describe("markSync derives the state from what was actually pushed", () => {
        const stateOf = async (v: string) => (await service.listForVariant(v))[0]

        it("a stock-only synced report keeps a pending price edit pending", async () => {
          await service.ensureOffers(["variant_ms1"], ["sc_a"])
          await service.setStocks("variant_ms1", { sc_a: 5 })
          await service.setPrice("variant_ms1", "sc_a", 12)
          await service.markSync("variant_ms1", "sc_a", { state: "pending" })
          await service.markSync("variant_ms1", "sc_a", { state: "synced", stock: 5 })
          const row = await stateOf("variant_ms1")
          expect(row.sync_state).toBe("pending")
          expect(row.last_synced_stock).toBe(5)
          expect(row.last_synced_price).toBeNull()
        })

        it("a price and stock report makes it synced and clears the error", async () => {
          await service.ensureOffers(["variant_ms2"], ["sc_a"])
          await service.setStocks("variant_ms2", { sc_a: 5 })
          await service.setPrice("variant_ms2", "sc_a", 12)
          await service.markSync("variant_ms2", "sc_a", { state: "failed", error: "x" })
          await service.markSync("variant_ms2", "sc_a", { state: "synced", price: 12, stock: 5 })
          const row = await stateOf("variant_ms2")
          expect(row).toMatchObject({ sync_state: "synced", last_error: null })
        })

        it("a null channel price (base fallback) with synced stock is synced", async () => {
          await service.ensureOffers(["variant_ms3"], ["sc_a"])
          await service.setStocks("variant_ms3", { sc_a: 2 })
          await service.markSync("variant_ms3", "sc_a", { state: "synced", stock: 2 })
          expect((await stateOf("variant_ms3")).sync_state).toBe("synced")
        })

        it("a report for a stale stock stays pending", async () => {
          await service.ensureOffers(["variant_ms4"], ["sc_a"])
          await service.setStocks("variant_ms4", { sc_a: 9 })
          await service.markSync("variant_ms4", "sc_a", { state: "synced", stock: 5 })
          expect((await stateOf("variant_ms4")).sync_state).toBe("pending")
        })

        it("a price-only report is synced once stock was already synced", async () => {
          await service.ensureOffers(["variant_ms5"], ["sc_a"])
          await service.setStocks("variant_ms5", { sc_a: 4 })
          await service.markSync("variant_ms5", "sc_a", { state: "synced", stock: 4 })
          await service.setPrice("variant_ms5", "sc_a", 7.5)
          await service.markSync("variant_ms5", "sc_a", { state: "pending" })
          await service.markSync("variant_ms5", "sc_a", { state: "synced", price: 7.5 })
          expect((await stateOf("variant_ms5")).sync_state).toBe("synced")
        })
      })

      it("setStocks and markSync persist", async () => {
        await service.ensureOffers(["variant_5"], ["sc_a", "sc_b"])
        await service.setStocks("variant_5", { sc_a: 3, sc_b: 4 })
        await service.markSync("variant_5", "sc_a", {
          state: "synced",
          price: 9.99,
          stock: 3,
        })
        await service.markSync("variant_5", "sc_b", {
          state: "failed",
          error: "boom",
        })
        const [a, b] = await service.listForVariant("variant_5")
        expect(a).toMatchObject({
          stock: 3,
          sync_state: "synced",
          last_synced_price: 9.99,
          last_synced_stock: 3,
          last_error: null,
        })
        expect(a.last_synced_at).not.toBeNull()
        expect(b).toMatchObject({
          stock: 4,
          sync_state: "failed",
          last_error: "boom",
        })
      })
    })
  },
})
