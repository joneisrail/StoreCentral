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

      it("GET /admin/suppliers applies default limit 20 and offset 0", async () => {
        const response = await api.get("/admin/suppliers", adminHeaders)

        expect(response.status).toBe(200)
        expect(response.data.limit).toBe(20)
        expect(response.data.offset).toBe(0)
      })

      it("GET /admin/suppliers returns the right page for a valid limit and offset", async () => {
        await createSupplier("P1")
        await createSupplier("P2")
        await createSupplier("P3")
        await createSupplier("P4")

        const response = await api.get(
          "/admin/suppliers?limit=2&offset=1",
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.suppliers).toHaveLength(2)
        expect(response.data.count).toBe(4)
        expect(response.data.limit).toBe(2)
        expect(response.data.offset).toBe(1)
      })

      it.each([
        ["limit=abc"],
        ["limit=0"],
        ["limit=101"],
        ["offset=-1"],
        ["offset=abc"],
        ["q=a&q=b"],
      ])("GET /admin/suppliers?%s returns 400", async (qs) => {
        const response = await api
          .get(`/admin/suppliers?${qs}`, adminHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(400)
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

      it("creates a supplier with all the detail fields", async () => {
        const body = {
          name: "Full Co",
          email: "full@example.com",
          contact_name: "Pat",
          website: "https://full.example.com",
          tax_id: "TAX-1",
          payment_terms: "Net 30",
          lead_time_days: 7,
        }
        const response = await api.post("/admin/suppliers", body, adminHeaders)

        expect(response.status).toBe(200)
        expect(response.data.supplier).toMatchObject({ ...body, is_active: true })
      })

      it("POST /admin/suppliers/:id clears fields with null", async () => {
        const created = (
          await api.post(
            "/admin/suppliers",
            {
              name: "Clearable",
              email: "c@example.com",
              website: "https://c.example.com",
              lead_time_days: 5,
            },
            adminHeaders
          )
        ).data.supplier

        const response = await api.post(
          `/admin/suppliers/${created.id}`,
          { website: null, lead_time_days: null, email: null },
          adminHeaders
        )
        expect(response.status).toBe(200)
        expect(response.data.supplier.website).toBeNull()
        expect(response.data.supplier.lead_time_days).toBeNull()
        expect(response.data.supplier.email).toBeNull()

        const fetched = await api.get(
          `/admin/suppliers/${created.id}`,
          adminHeaders
        )
        expect(fetched.data.supplier.website).toBeNull()
        expect(fetched.data.supplier.lead_time_days).toBeNull()
        expect(fetched.data.supplier.name).toBe("Clearable")
      })

      it.each([[-1], [1.5]])(
        "rejects lead_time_days %s with 400",
        async (lead_time_days) => {
          const response = await api
            .post(
              "/admin/suppliers",
              { name: "Bad", lead_time_days },
              adminHeaders
            )
            .catch((e) => e.response)
          expect(response.status).toBe(400)
        }
      )

      it("GET filters by is_active", async () => {
        const active = await createSupplier("Active One")
        const inactive = await createSupplier("Inactive One")
        await api.post(
          `/admin/suppliers/${inactive.id}`,
          { is_active: false },
          adminHeaders
        )

        const idsOf = async (qs: string) =>
          (await api.get(`/admin/suppliers${qs}`, adminHeaders)).data.suppliers
            .map((s: { id: string }) => s.id)
            .sort()

        expect(await idsOf("?is_active=false")).toEqual([inactive.id])
        expect(await idsOf("?is_active=true")).toEqual([active.id])
        expect(await idsOf("")).toEqual([active.id, inactive.id].sort())
      })

      it("GET rejects an invalid is_active with 400", async () => {
        const response = await api
          .get("/admin/suppliers?is_active=maybe", adminHeaders)
          .catch((e) => e.response)
        expect(response.status).toBe(400)
      })

      it("GET q treats LIKE wildcards literally", async () => {
        await createSupplier("50% Off Goods")
        await createSupplier("500 Items")

        const response = await api.get("/admin/suppliers?q=50%25", adminHeaders)
        expect(
          response.data.suppliers.map((s: { name: string }) => s.name)
        ).toEqual(["50% Off Goods"])
      })

      it("GET treats a whitespace-only q as no filter", async () => {
        await createSupplier("One")
        await createSupplier("Two")

        const response = await api.get("/admin/suppliers?q=%20%20", adminHeaders)
        expect(response.data.count).toBe(2)
      })

      it("a supplier created with only a name is active with null detail fields", async () => {
        const supplierModule = getContainer().resolve(SUPPLIER_MODULE) as any
        const legacy = await supplierModule.createSuppliers({ name: "Legacy" })

        const fetched = (
          await api.get(`/admin/suppliers/${legacy.id}`, adminHeaders)
        ).data.supplier
        expect(fetched).toMatchObject({
          is_active: true,
          contact_name: null,
          website: null,
          tax_id: null,
          payment_terms: null,
          lead_time_days: null,
        })
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
