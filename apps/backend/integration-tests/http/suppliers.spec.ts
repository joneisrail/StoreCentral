import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PURCHASE_MODULE } from "../../src/modules/purchase"
import { SUPPLIER_MODULE } from "../../src/modules/supplier"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(60000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const adminHeaders = { headers: {} as Record<string, string> }

    beforeEach(async () => {
      await createAdminUser(getContainer(), adminHeaders)
    })

    const createSupplier = async (name: string) => {
      const response = await api.post(
        "/admin/suppliers",
        { name },
        adminHeaders
      )
      return response.data.supplier
    }

    describe("/admin/suppliers", () => {
      it("POST /admin/suppliers creates a supplier", async () => {
        const response = await api.post(
          "/admin/suppliers",
          { name: "Acme Supply", email: "acme@example.com" },
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.supplier.id).toBeDefined()
        expect(response.data.supplier.name).toBe("Acme Supply")
      })

      it("POST rejects a missing name with 400", async () => {
        const response = await api
          .post("/admin/suppliers", { email: "x@example.com" }, adminHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("GET /admin/suppliers lists, paginates and filters with q by name", async () => {
        await createSupplier("Alpha Traders")
        await createSupplier("Beta Imports")
        await createSupplier("Alpha Wholesale")

        const all = await api.get("/admin/suppliers", adminHeaders)
        expect(all.status).toBe(200)
        expect(all.data.count).toBe(3)
        expect(all.data.suppliers).toHaveLength(3)

        const page = await api.get(
          "/admin/suppliers?limit=2&offset=2",
          adminHeaders
        )
        expect(page.data.suppliers).toHaveLength(1)
        expect(page.data.count).toBe(3)
        expect(page.data.limit).toBe(2)
        expect(page.data.offset).toBe(2)

        const filtered = await api.get("/admin/suppliers?q=alpha", adminHeaders)
        expect(filtered.data.count).toBe(2)
        expect(
          filtered.data.suppliers.map((s: { name: string }) => s.name).sort()
        ).toEqual(["Alpha Traders", "Alpha Wholesale"])
      })

      it("GET /admin/suppliers/:id returns 404 for an unknown id", async () => {
        const response = await api
          .get("/admin/suppliers/sup_missing", adminHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(404)
      })

      it("POST /admin/suppliers/:id updates the email", async () => {
        const supplier = await createSupplier("Gamma")

        const response = await api.post(
          `/admin/suppliers/${supplier.id}`,
          { email: "new@example.com" },
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.supplier.email).toBe("new@example.com")

        const fetched = await api.get(
          `/admin/suppliers/${supplier.id}`,
          adminHeaders
        )
        expect(fetched.data.supplier.email).toBe("new@example.com")
      })

      it("DELETE /admin/suppliers/:id removes a supplier with no purchases", async () => {
        const supplier = await createSupplier("Delta")

        const response = await api.delete(
          `/admin/suppliers/${supplier.id}`,
          adminHeaders
        )
        expect(response.status).toBe(200)
        expect(response.data).toEqual({
          id: supplier.id,
          object: "supplier",
          deleted: true,
        })

        const after = await api
          .get(`/admin/suppliers/${supplier.id}`, adminHeaders)
          .catch((e) => e.response)
        expect(after.status).toBe(404)
      })

      it("DELETE refuses with 400 and keeps the supplier when it has a purchase", async () => {
        const container = getContainer()
        const supplier = await createSupplier("Epsilon")

        const purchaseModule = container.resolve(PURCHASE_MODULE) as any
        const purchase = await purchaseModule.createPurchases({})
        await container.resolve(ContainerRegistrationKeys.LINK).create({
          [PURCHASE_MODULE]: { purchase_id: purchase.id },
          [SUPPLIER_MODULE]: { supplier_id: supplier.id },
        })

        const response = await api
          .delete(`/admin/suppliers/${supplier.id}`, adminHeaders)
          .catch((e) => e.response)
        expect(response.status).toBe(400)

        const fetched = await api.get(
          `/admin/suppliers/${supplier.id}`,
          adminHeaders
        )
        expect(fetched.status).toBe(200)
      })
    })
  },
})
