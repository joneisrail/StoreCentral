import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import PurchaseModuleService from "../service"

moduleIntegrationTestRunner<PurchaseModuleService>({
  moduleName: "purchase",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("PurchaseModuleService", () => {
      it("creates a purchase with defaults", async () => {
        const purchase = await service.createPurchases({})
        expect(purchase.status).toBe("draft")
        expect(purchase.currency_code).toBe("usd")
        expect(Number(purchase.shipping_cost)).toBe(0)
        expect(Number(purchase.tax)).toBe(0)
        expect(Number(purchase.other_cost)).toBe(0)
        expect(typeof purchase.display_id).toBe("number")
      })

      it("assigns increasing display_ids", async () => {
        const first = await service.createPurchases({})
        const second = await service.createPurchases({})
        expect(second.display_id).toBeGreaterThan(first.display_id)
      })

      it("returns items created with purchase_id", async () => {
        const purchase = await service.createPurchases({})
        await service.createPurchaseItems({
          purchase_id: purchase.id,
          variant_id: "variant_1",
          sku: "SKU-1",
          title: "Widget",
          quantity: 3,
          unit_cost: 12.5,
        })
        const found = await service.retrievePurchase(purchase.id, {
          relations: ["items"],
        })
        expect(found.items).toHaveLength(1)
        expect(found.items[0].quantity_received).toBe(0)
        expect(Number(found.items[0].unit_cost)).toBe(12.5)
      })
    })
  },
})
