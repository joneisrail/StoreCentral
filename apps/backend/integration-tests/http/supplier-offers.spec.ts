import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const adminHeaders = { headers: {} as Record<string, string> }
    let counter = 0

    beforeEach(async () => {
      await createAdminUser(getContainer(), adminHeaders)
    })

    const createSupplier = async (body: Record<string, unknown>) =>
      (await api.post("/admin/suppliers", body, adminHeaders)).data
        .supplier as { id: string }

    // A product with one variant per entry in `skus`.
    const createProduct = async (skus: string[]) => {
      counter += 1
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Product ${counter}`,
            options: [{ title: "size", values: skus }],
            variants: skus.map((sku) => ({
              title: `Var ${sku}`,
              sku,
              manage_inventory: false,
              prices: [{ currency_code: "usd", amount: 100 }],
              options: { size: sku },
            })),
          },
          adminHeaders
        )
      ).data.product
      return product as {
        id: string
        variants: { id: string; title: string; sku: string }[]
      }
    }

    const offer = (
      supplierId: string,
      variantId: string,
      body: Record<string, unknown>
    ) =>
      api.post(
        `/admin/suppliers/${supplierId}/products`,
        { variant_id: variantId, ...body },
        adminHeaders
      )

    const get = (params: string, headers = adminHeaders) =>
      api
        .get(`/admin/supplier-offers${params}`, headers)
        .catch((e) => e.response)

    describe("GET /admin/supplier-offers", () => {
      it("lists offers cheapest first, marks the lowest, and keeps inactive suppliers unmarked", async () => {
        const product = await createProduct(["A-1"])
        const variant = product.variants[0]
        const pricey = await createSupplier({
          name: "Pricey",
          lead_time_days: 7,
          payment_terms: "Net 30",
        })
        const cheap = await createSupplier({ name: "Cheap", lead_time_days: 3 })
        const inactive = await createSupplier({ name: "Gone" })

        await offer(pricey.id, variant.id, {
          supplier_sku: "P-1",
          supplier_title: "Pricey name",
          unit_cost: 9.5,
        })
        await offer(cheap.id, variant.id, {
          supplier_sku: "C-1",
          unit_cost: 4.25,
        })
        await offer(inactive.id, variant.id, {
          supplier_sku: "I-1",
          unit_cost: 1,
        })
        await api.post(
          `/admin/suppliers/${inactive.id}`,
          { is_active: false },
          adminHeaders
        )

        const response = await get(`?product_id=${product.id}`)

        expect(response.status).toBe(200)
        expect(response.data.variants).toHaveLength(1)
        const v = response.data.variants[0]
        expect(v).toMatchObject({
          variant_id: variant.id,
          title: variant.title,
          sku: "A-1",
        })
        expect(v.offers.map((o: any) => o.supplier_sku)).toEqual([
          "I-1",
          "C-1",
          "P-1",
        ])
        expect(v.offers.map((o: any) => o.is_lowest)).toEqual([
          false,
          true,
          false,
        ])
        expect(v.offers[1]).toEqual({
          supplier_product_id: expect.any(String),
          supplier: {
            id: cheap.id,
            name: "Cheap",
            is_active: true,
            lead_time_days: 3,
            payment_terms: null,
          },
          supplier_sku: "C-1",
          supplier_title: null,
          unit_cost: 4.25,
          is_lowest: true,
        })
        expect(v.offers[0].supplier.is_active).toBe(false)
        expect(v.offers[2].supplier).toMatchObject({
          payment_terms: "Net 30",
          lead_time_days: 7,
        })
      })

      it("returns offers: [] for a variant nobody offers", async () => {
        const product = await createProduct(["B-1"])
        const response = await get(`?product_id=${product.id}`)
        expect(response.status).toBe(200)
        expect(response.data.variants).toEqual([
          {
            variant_id: product.variants[0].id,
            title: product.variants[0].title,
            sku: "B-1",
            offers: [],
          },
        ])
      })

      it("gives each variant of the product its own offers", async () => {
        const product = await createProduct(["V-1", "V-2"])
        const [v1, v2] = product.variants
        const s1 = await createSupplier({ name: "One" })
        const s2 = await createSupplier({ name: "Two" })
        await offer(s1.id, v1.id, { supplier_sku: "ONE-1", unit_cost: 3 })
        await offer(s2.id, v2.id, { supplier_sku: "TWO-2" })

        const response = await get(`?product_id=${product.id}`)
        const byId = Object.fromEntries(
          response.data.variants.map((v: any) => [v.variant_id, v])
        )
        expect(byId[v1.id].offers.map((o: any) => o.supplier_sku)).toEqual([
          "ONE-1",
        ])
        expect(byId[v1.id].offers[0].is_lowest).toBe(true)
        expect(byId[v2.id].offers.map((o: any) => o.supplier_sku)).toEqual([
          "TWO-2",
        ])
        expect(byId[v2.id].offers[0]).toMatchObject({
          unit_cost: null,
          is_lowest: false,
        })
      })

      it("keeps equally priced offers in creation order and marks both lowest", async () => {
        const product = await createProduct(["T-1"])
        const variant = product.variants[0]
        const first = await createSupplier({ name: "First" })
        const second = await createSupplier({ name: "Second" })
        await offer(first.id, variant.id, { supplier_sku: "F-1", unit_cost: 5 })
        await offer(second.id, variant.id, { supplier_sku: "S-1", unit_cost: 5 })

        for (let i = 0; i < 3; i++) {
          const response = await get(`?product_id=${product.id}`)
          const offers = response.data.variants[0].offers
          expect(offers.map((o: any) => o.supplier_sku)).toEqual(["F-1", "S-1"])
          expect(offers.map((o: any) => o.is_lowest)).toEqual([true, true])
        }
      })

      it("returns 404 for an unknown product", async () => {
        const response = await get("?product_id=prod_missing")
        expect(response.status).toBe(404)
      })

      it("returns 400 when product_id is missing or blank", async () => {
        expect((await get("")).status).toBe(400)
        expect((await get("?product_id=")).status).toBe(400)
        expect((await get("?product_id=%20%20")).status).toBe(400)
      })

      it("returns 401 without authentication", async () => {
        const response = await get("?product_id=prod_x", { headers: {} })
        expect(response.status).toBe(401)
      })
    })
  },
})
