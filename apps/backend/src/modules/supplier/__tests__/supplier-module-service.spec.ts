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
