import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import SupplierModuleService from "../service"

moduleIntegrationTestRunner<SupplierModuleService>({
  moduleName: "supplier",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("SupplierProduct", () => {
      const make = async (name = "Acme") => service.createSuppliers({ name })
      const row = (supplier_id: string, variant_id: string, key: string) => ({
        supplier_id,
        variant_id,
        supplier_sku: key.toUpperCase(),
        supplier_sku_key: key,
      })

      it("rejects the same sku key twice for one supplier", async () => {
        const s = await make()
        await service.createSupplierProducts(row(s.id, "variant_1", "ab-1"))
        await expect(
          service.createSupplierProducts(row(s.id, "variant_2", "ab-1"))
        ).rejects.toThrow()
      })

      it("rejects the same variant twice for one supplier", async () => {
        const s = await make()
        await service.createSupplierProducts(row(s.id, "variant_1", "ab-1"))
        await expect(
          service.createSupplierProducts(row(s.id, "variant_1", "ab-2"))
        ).rejects.toThrow()
      })

      it("allows a different supplier to reuse code and variant", async () => {
        const a = await make("A")
        const b = await make("B")
        await service.createSupplierProducts(row(a.id, "variant_1", "ab-1"))
        await expect(
          service.createSupplierProducts(row(b.id, "variant_1", "ab-1"))
        ).resolves.toBeDefined()
      })

      it("allows re-adding code and variant after soft delete", async () => {
        const s = await make()
        const created = await service.createSupplierProducts(
          row(s.id, "variant_1", "ab-1")
        )
        await service.deleteSupplierProducts(created.id)
        await expect(
          service.createSupplierProducts(row(s.id, "variant_1", "ab-1"))
        ).resolves.toBeDefined()
      })

      it("round-trips unit_cost and defaults to null", async () => {
        const s = await make()
        const withCost = await service.createSupplierProducts({
          ...row(s.id, "variant_1", "ab-1"),
          unit_cost: 12.5,
        })
        const without = await service.createSupplierProducts(
          row(s.id, "variant_2", "ab-2")
        )
        const a = await service.retrieveSupplierProduct(withCost.id)
        const b = await service.retrieveSupplierProduct(without.id)
        expect(Number(a.unit_cost)).toBe(12.5)
        expect(b.unit_cost).toBeNull()
      })
    })
  },
})
