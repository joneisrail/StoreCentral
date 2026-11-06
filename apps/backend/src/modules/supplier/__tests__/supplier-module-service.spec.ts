import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import SupplierModuleService from "../service"

moduleIntegrationTestRunner<SupplierModuleService>({
  moduleName: "supplier",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("SupplierModuleService", () => {
      it("creates a supplier with only a name", async () => {
        const supplier = await service.createSuppliers({ name: "Acme" })
        expect(supplier.name).toBe("Acme")
        expect(supplier.email).toBeNull()
        expect(supplier.phone).toBeNull()
        expect(supplier.address).toBeNull()
        expect(supplier.notes).toBeNull()
        expect(supplier.contact_name).toBeNull()
        expect(supplier.website).toBeNull()
        expect(supplier.tax_id).toBeNull()
        expect(supplier.payment_terms).toBeNull()
        expect(supplier.lead_time_days).toBeNull()
        expect(supplier.is_active).toBe(true)
      })

      it("persists is_active false", async () => {
        const supplier = await service.createSuppliers({ name: "Acme" })
        await service.updateSuppliers({ id: supplier.id, is_active: false })
        const fetched = await service.retrieveSupplier(supplier.id)
        expect(fetched.is_active).toBe(false)
      })

      it("rejects a supplier without a name", async () => {
        await expect(
          service.createSuppliers({} as any)
        ).rejects.toThrow()
      })

      it("updates a supplier's phone", async () => {
        const supplier = await service.createSuppliers({ name: "Acme" })
        const updated = await service.updateSuppliers({
          id: supplier.id,
          phone: "555-0100",
        })
        expect(updated.phone).toBe("555-0100")
      })
    })
  },
})
