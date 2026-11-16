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
