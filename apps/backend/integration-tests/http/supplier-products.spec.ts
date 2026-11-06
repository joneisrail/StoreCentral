import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(300000)

const CODE_USED = /code .* already used/i

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const adminHeaders = { headers: {} as Record<string, string> }
    let counter = 0

    beforeEach(async () => {
      await createAdminUser(getContainer(), adminHeaders)
    })

    const createSupplier = async (name: string) =>
      (await api.post("/admin/suppliers", { name }, adminHeaders)).data
        .supplier as { id: string }

    const createVariant = async (
      opts: { title?: string; sku?: string; productTitle?: string } = {}
    ) => {
      counter += 1
      const product = (
        await api.post(
          "/admin/products",
          {
            title: opts.productTitle ?? `Product ${counter}`,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title: opts.title ?? `Variant ${counter}`,
                sku: opts.sku ?? `SKU-${counter}`,
                manage_inventory: false,
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "large" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      const variant = product.variants[0]
      return {
        id: variant.id as string,
        sku: variant.sku as string,
        title: variant.title as string,
        product_id: product.id as string,
        product_title: product.title as string,
      }
    }

    const productsUrl = (supplierId: string) =>
      `/admin/suppliers/${supplierId}/products`

    const addProduct = async (
      supplierId: string,
      body: Record<string, unknown>
    ) =>
      (await api.post(productsUrl(supplierId), body, adminHeaders)).data
        .supplier_product

    const post = (url: string, body: Record<string, unknown>) =>
      api.post(url, body, adminHeaders).catch((e) => e.response)

    const list = async (supplierId: string, params = "") =>
      (await api.get(`${productsUrl(supplierId)}${params}`, adminHeaders)).data

    describe("/admin/suppliers/:id/products", () => {
      it("POST links a variant and GET lists it with variant and product details", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant({
          title: "Blue Large",
          sku: "OUR-BLUE-L",
          productTitle: "Blue Shirt",
        })

        const response = await api.post(
          productsUrl(supplier.id),
          {
            variant_id: variant.id,
            supplier_sku: "  AC-100  ",
            supplier_title: "Shirt blue L",
            unit_cost: 4.5,
            notes: "case of 12",
          },
          adminHeaders
        )

        expect(response.status).toBe(200)
        const row = response.data.supplier_product
        expect(row).toEqual({
          id: expect.any(String),
          supplier_id: supplier.id,
          variant_id: variant.id,
          supplier_sku: "AC-100",
          supplier_title: "Shirt blue L",
          unit_cost: 4.5,
          notes: "case of 12",
          variant: {
            id: variant.id,
            title: "Blue Large",
            sku: "OUR-BLUE-L",
            product: { id: variant.product_id, title: "Blue Shirt" },
          },
        })

        const listed = await list(supplier.id)
        expect(listed.count).toBe(1)
        expect(listed.offset).toBe(0)
        expect(listed.limit).toBe(20)
        expect(listed.supplier_products).toEqual([row])
      })

      it("POST returns 404 for an unknown supplier", async () => {
        const variant = await createVariant()
        const response = await post(productsUrl("sup_missing"), {
          variant_id: variant.id,
          supplier_sku: "X-1",
        })
        expect(response.status).toBe(404)
      })

      it("POST returns 400 for an unknown variant", async () => {
        const supplier = await createSupplier("Acme")
        const response = await post(productsUrl(supplier.id), {
          variant_id: "variant_missing",
          supplier_sku: "X-1",
        })
        expect(response.status).toBe(400)
        expect(response.data.message).toMatch(/variant/i)
      })

      it("POST rejects a blank code, a negative cost and unknown fields with 400", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()

        for (const body of [
          { variant_id: variant.id, supplier_sku: "   " },
          { variant_id: variant.id, supplier_sku: "A", unit_cost: -1 },
          { variant_id: variant.id, supplier_sku: "A", extra: true },
        ]) {
          const response = await post(productsUrl(supplier.id), body)
          expect(response.status).toBe(400)
        }
        expect((await list(supplier.id)).count).toBe(0)
      })

      it("POST rejects a repeated variant and a repeated code (case and spaces ignored) on the same supplier", async () => {
        const supplier = await createSupplier("Acme")
        const v1 = await createVariant()
        const v2 = await createVariant()
        await addProduct(supplier.id, { variant_id: v1.id, supplier_sku: "AB-1" })

        const sameVariant = await post(productsUrl(supplier.id), {
          variant_id: v1.id,
          supplier_sku: "OTHER",
        })
        expect(sameVariant.status).toBe(400)
        expect(sameVariant.data.message).toContain(
          "already on this supplier's list"
        )

        const sameCode = await post(productsUrl(supplier.id), {
          variant_id: v2.id,
          supplier_sku: "  ab-1 ",
        })
        expect(sameCode.status).toBe(400)
        expect(sameCode.data.message).toMatch(CODE_USED)

        expect((await list(supplier.id)).count).toBe(1)
      })

      it("another supplier may use the same code and variant", async () => {
        const s1 = await createSupplier("Acme")
        const s2 = await createSupplier("Beta")
        const variant = await createVariant()
        await addProduct(s1.id, { variant_id: variant.id, supplier_sku: "AB-1" })

        const response = await post(productsUrl(s2.id), {
          variant_id: variant.id,
          supplier_sku: "AB-1",
        })
        expect(response.status).toBe(200)
      })

      it("concurrent POSTs with the same code yield one 200 and one 400 code-already-used", async () => {
        const supplier = await createSupplier("Acme")
        const v1 = await createVariant()
        const v2 = await createVariant()

        const responses = await Promise.all([
          post(productsUrl(supplier.id), { variant_id: v1.id, supplier_sku: "RACE" }),
          post(productsUrl(supplier.id), { variant_id: v2.id, supplier_sku: "race" }),
        ])

        const statuses = responses.map((r) => r.status).sort()
        expect(statuses).toEqual([200, 400])
        const failed = responses.find((r) => r.status === 400)!
        expect(failed.data.type).toBe("invalid_data")
        expect(failed.data.message).toMatch(CODE_USED)
        expect((await list(supplier.id)).count).toBe(1)
      })

      it("POST /:product_id edits code, title and cost; null clears the cost", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()
        const row = await addProduct(supplier.id, {
          variant_id: variant.id,
          supplier_sku: "AB-1",
          supplier_title: "Old",
          unit_cost: 3,
          notes: "n",
        })

        const edited = await api.post(
          `${productsUrl(supplier.id)}/${row.id}`,
          { supplier_sku: " AB-2 ", supplier_title: "New", unit_cost: 7.25 },
          adminHeaders
        )
        expect(edited.status).toBe(200)
        expect(edited.data.supplier_product).toMatchObject({
          id: row.id,
          variant_id: variant.id,
          supplier_sku: "AB-2",
          supplier_title: "New",
          unit_cost: 7.25,
          notes: "n",
          variant: { id: variant.id },
        })

        const cleared = await api.post(
          `${productsUrl(supplier.id)}/${row.id}`,
          { unit_cost: null, supplier_title: null, notes: null },
          adminHeaders
        )
        expect(cleared.data.supplier_product).toMatchObject({
          supplier_sku: "AB-2",
          supplier_title: null,
          unit_cost: null,
          notes: null,
        })
      })

      it("POST /:product_id may change only the case of its own code", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()
        const row = await addProduct(supplier.id, {
          variant_id: variant.id,
          supplier_sku: "ab-1",
        })

        const response = await post(`${productsUrl(supplier.id)}/${row.id}`, {
          supplier_sku: "AB-1",
        })
        expect(response.status).toBe(200)
        expect(response.data.supplier_product.supplier_sku).toBe("AB-1")
      })

      it("POST /:product_id rejects another entry's code, a variant_id and a foreign product_id", async () => {
        const supplier = await createSupplier("Acme")
        const other = await createSupplier("Beta")
        const v1 = await createVariant()
        const v2 = await createVariant()
        await addProduct(supplier.id, { variant_id: v1.id, supplier_sku: "AB-1" })
        const row = await addProduct(supplier.id, {
          variant_id: v2.id,
          supplier_sku: "AB-2",
        })

        const taken = await post(`${productsUrl(supplier.id)}/${row.id}`, {
          supplier_sku: "ab-1",
        })
        expect(taken.status).toBe(400)
        expect(taken.data.message).toMatch(CODE_USED)

        const withVariant = await post(`${productsUrl(supplier.id)}/${row.id}`, {
          variant_id: v1.id,
        })
        expect(withVariant.status).toBe(400)

        const foreign = await post(`${productsUrl(other.id)}/${row.id}`, {
          supplier_sku: "Z",
        })
        expect(foreign.status).toBe(404)

        const unchanged = (await list(supplier.id)).supplier_products.find(
          (p: { id: string }) => p.id === row.id
        )
        expect(unchanged).toMatchObject({ supplier_sku: "AB-2", variant_id: v2.id })
      })

      it("DELETE /:product_id removes the entry but not the variant; twice is 404", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()
        const row = await addProduct(supplier.id, {
          variant_id: variant.id,
          supplier_sku: "AB-1",
        })

        const response = await api.delete(
          `${productsUrl(supplier.id)}/${row.id}`,
          adminHeaders
        )
        expect(response.status).toBe(200)
        expect(response.data).toEqual({
          id: row.id,
          object: "supplier_product",
          deleted: true,
        })
        expect((await list(supplier.id)).count).toBe(0)

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: variants } = await query.graph({
          entity: "product_variant",
          fields: ["id"],
          filters: { id: variant.id },
        })
        expect(variants).toHaveLength(1)

        const again = await api
          .delete(`${productsUrl(supplier.id)}/${row.id}`, adminHeaders)
          .catch((e) => e.response)
        expect(again.status).toBe(404)

        // The same variant and code can be linked again after unlinking.
        const relinked = await post(productsUrl(supplier.id), {
          variant_id: variant.id,
          supplier_sku: "AB-1",
        })
        expect(relinked.status).toBe(200)
      })

      it("DELETE /:product_id of another supplier's entry returns 404", async () => {
        const supplier = await createSupplier("Acme")
        const other = await createSupplier("Beta")
        const variant = await createVariant()
        const row = await addProduct(supplier.id, {
          variant_id: variant.id,
          supplier_sku: "AB-1",
        })

        const response = await api
          .delete(`${productsUrl(other.id)}/${row.id}`, adminHeaders)
          .catch((e) => e.response)
        expect(response.status).toBe(404)
        expect((await list(supplier.id)).count).toBe(1)
      })

      it("GET q searches supplier code, supplier title, our sku, variant title and product title", async () => {
        const supplier = await createSupplier("Acme")
        const a = await createVariant({
          title: "Crimson",
          sku: "OUR-111",
          productTitle: "Teapot",
        })
        const b = await createVariant({
          title: "Azure",
          sku: "OUR-222",
          productTitle: "Kettle",
        })
        const c = await createVariant({
          title: "Olive",
          sku: "OUR-333",
          productTitle: "Saucepan",
        })
        await addProduct(supplier.id, {
          variant_id: a.id,
          supplier_sku: "ZX-9",
          supplier_title: "Ceramic pot",
        })
        await addProduct(supplier.id, {
          variant_id: b.id,
          supplier_sku: "QQ-1",
          supplier_title: "Steel boiler",
        })
        await addProduct(supplier.id, {
          variant_id: c.id,
          supplier_sku: "WW_5",
          supplier_title: "100% copper",
        })

        const variantIds = async (q: string) =>
          (await list(supplier.id, `?q=${encodeURIComponent(q)}`))
            .supplier_products.map((p: { variant_id: string }) => p.variant_id)

        expect(await variantIds("zx-9")).toEqual([a.id])
        expect(await variantIds("boiler")).toEqual([b.id])
        expect(await variantIds("our-333")).toEqual([c.id])
        expect(await variantIds("crims")).toEqual([a.id])
        expect(await variantIds("kettle")).toEqual([b.id])
        expect(await variantIds("%")).toEqual([c.id])
        expect(await variantIds("_")).toEqual([c.id])
        expect(await variantIds("   ")).toHaveLength(3)
      })

      it("GET q=% returns nothing when no value contains %", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()
        await addProduct(supplier.id, { variant_id: variant.id, supplier_sku: "AB-1" })

        const result = await list(supplier.id, "?q=%25")
        expect(result.count).toBe(0)
        expect(result.supplier_products).toEqual([])
      })

      it("GET filters by variant_id and paginates newest first", async () => {
        const supplier = await createSupplier("Acme")
        const variants = [
          await createVariant(),
          await createVariant(),
          await createVariant(),
        ]
        for (const [i, v] of variants.entries()) {
          await addProduct(supplier.id, {
            variant_id: v.id,
            supplier_sku: `CODE-${i}`,
          })
        }

        const byVariant = await list(supplier.id, `?variant_id=${variants[1].id}`)
        expect(byVariant.count).toBe(1)
        expect(byVariant.supplier_products[0].variant_id).toBe(variants[1].id)

        const page = await list(supplier.id, "?limit=2&offset=1")
        expect(page.count).toBe(3)
        expect(page.limit).toBe(2)
        expect(page.offset).toBe(1)
        expect(
          page.supplier_products.map((p: { supplier_sku: string }) => p.supplier_sku)
        ).toEqual(["CODE-1", "CODE-0"])
      })

      it("GET returns 404 for an unknown supplier", async () => {
        const response = await api
          .get(productsUrl("sup_missing"), adminHeaders)
          .catch((e) => e.response)
        expect(response.status).toBe(404)
      })

      it("GET still lists an entry whose variant was deleted from the catalog, with variant null", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()
        await addProduct(supplier.id, { variant_id: variant.id, supplier_sku: "AB-1" })

        await api.delete(`/admin/products/${variant.product_id}`, adminHeaders)

        const response = await api.get(productsUrl(supplier.id), adminHeaders)
        expect(response.status).toBe(200)
        expect(response.data.supplier_products).toHaveLength(1)
        expect(response.data.supplier_products[0]).toMatchObject({
          variant_id: variant.id,
          variant: null,
        })
      })

      it("an inactive supplier can still add, edit and unlink", async () => {
        const supplier = await createSupplier("Dormant")
        await api.post(
          `/admin/suppliers/${supplier.id}`,
          { is_active: false },
          adminHeaders
        )
        const variant = await createVariant()

        const added = await post(productsUrl(supplier.id), {
          variant_id: variant.id,
          supplier_sku: "AB-1",
        })
        expect(added.status).toBe(200)
        const id = added.data.supplier_product.id

        const edited = await post(`${productsUrl(supplier.id)}/${id}`, {
          notes: "still buying",
        })
        expect(edited.status).toBe(200)

        const removed = await api.delete(
          `${productsUrl(supplier.id)}/${id}`,
          adminHeaders
        )
        expect(removed.status).toBe(200)
      })
    })
  },
})
