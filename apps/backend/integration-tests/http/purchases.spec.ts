import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PURCHASE_MODULE } from "../../src/modules/purchase"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const adminHeaders = { headers: {} as Record<string, string> }
    let counter = 0

    beforeEach(async () => {
      await createAdminUser(getContainer(), adminHeaders)
    })

    const createSupplier = async (name: string) =>
      (await api.post("/admin/suppliers", { name }, adminHeaders)).data.supplier

    const createVariant = async (title = "Blue Shirt") => {
      counter += 1
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Product ${counter}`,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title,
                sku: `SKU-${counter}`,
                manage_inventory: false,
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "large" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      return product.variants[0] as { id: string; sku: string; title: string }
    }

    const countPurchases = async () => {
      const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
      const [, count] = await purchaseModule.listAndCountPurchases({})
      return count as number
    }

    const createPurchase = async (body: Record<string, unknown>) =>
      (await api.post("/admin/purchases", body, adminHeaders)).data.purchase

    const linksForItem = async (purchaseItemId: string) => {
      const link = getContainer().resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      const linkModule = link.getLinkModule(
        "purchase",
        "purchase_item_id",
        Modules.PRODUCT,
        "product_variant_id"
      )
      return (await linkModule.list({
        purchase_item_id: purchaseItemId,
      })) as { purchase_item_id: string; product_variant_id: string }[]
    }

    const ids = (purchases: { id: string }[]) => purchases.map((p) => p.id)

    describe("/admin/purchases", () => {
      it("POST /admin/purchases creates a draft with a PO- reference, linked supplier and item snapshots (sku and title copied from the variant)", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()

        const response = await api.post(
          "/admin/purchases",
          {
            supplier_id: supplier.id,
            items: [{ variant_id: variant.id, quantity: 10, unit_cost: 2.5 }],
            shipping_cost: 5,
            tax: 1.25,
            notes: "first order",
          },
          adminHeaders
        )

        expect(response.status).toBe(200)
        const purchase = response.data.purchase
        expect(purchase.status).toBe("draft")
        expect(purchase.reference).toMatch(/^PO-\d{4}$/)
        expect(purchase.currency_code).toBe("usd")
        expect(purchase.supplier).toEqual({ id: supplier.id, name: "Acme" })
        expect(purchase.items).toHaveLength(1)
        expect(purchase.items[0]).toMatchObject({
          variant_id: variant.id,
          sku: variant.sku,
          title: variant.title,
          quantity: 10,
          quantity_received: 0,
          remaining: 10,
          unit_cost: 2.5,
        })
        expect(purchase.subtotal).toBe(25)
        expect(purchase.total).toBe(31.25)
        expect(purchase.shipping_cost).toBe(5)
        expect(purchase.tax).toBe(1.25)
        expect(purchase.other_cost).toBe(0)
        expect(purchase.notes).toBe("first order")
        expect(purchase.receipts).toEqual([])
      })

      it("POST rejects an unknown supplier with 404 and writes nothing", async () => {
        const variant = await createVariant()

        const response = await api
          .post(
            "/admin/purchases",
            {
              supplier_id: "sup_missing",
              items: [{ variant_id: variant.id, quantity: 1, unit_cost: 1 }],
            },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(404)
        expect(await countPurchases()).toBe(0)
      })

      it("POST rejects an unknown variant with 404 and writes nothing", async () => {
        const supplier = await createSupplier("Acme")

        const response = await api
          .post(
            "/admin/purchases",
            {
              supplier_id: supplier.id,
              items: [
                { variant_id: "variant_missing", quantity: 1, unit_cost: 1 },
              ],
            },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(404)
        expect(await countPurchases()).toBe(0)
      })

      it.each([
        ["quantity 0", { quantity: 0, unit_cost: 1 }],
        ["quantity 1.5", { quantity: 1.5, unit_cost: 1 }],
        ["negative unit_cost", { quantity: 1, unit_cost: -1 }],
      ])("POST rejects %s with 400 and writes nothing", async (_name, line) => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()

        const response = await api
          .post(
            "/admin/purchases",
            {
              supplier_id: supplier.id,
              items: [{ variant_id: variant.id, ...line }],
            },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
        expect(await countPurchases()).toBe(0)
      })

      it("POST rejects empty items with 400 and writes nothing", async () => {
        const supplier = await createSupplier("Acme")

        const response = await api
          .post(
            "/admin/purchases",
            { supplier_id: supplier.id, items: [] },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
        expect(await countPurchases()).toBe(0)
      })

      it("GET /admin/purchases lists newest first, filters by status, and filters by supplier_id", async () => {
        const supplierA = await createSupplier("Supplier A")
        const supplierB = await createSupplier("Supplier B")
        const variant = await createVariant()
        const line = { variant_id: variant.id, quantity: 1, unit_cost: 1 }

        const first = await createPurchase({
          supplier_id: supplierA.id,
          items: [line],
        })
        const second = await createPurchase({
          supplier_id: supplierB.id,
          items: [line],
        })
        const third = await createPurchase({
          supplier_id: supplierA.id,
          items: [line],
        })

        const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
        await purchaseModule.updatePurchases({ id: second.id, status: "ordered" })

        const all = await api.get("/admin/purchases", adminHeaders)
        expect(all.status).toBe(200)
        expect(all.data.count).toBe(3)
        expect(all.data.limit).toBe(20)
        expect(all.data.offset).toBe(0)
        expect(ids(all.data.purchases)).toEqual([third.id, second.id, first.id])
        expect(all.data.purchases[0].supplier).toEqual({
          id: supplierA.id,
          name: "Supplier A",
        })

        const ordered = await api.get(
          "/admin/purchases?status=ordered",
          adminHeaders
        )
        expect(ordered.data.count).toBe(1)
        expect(ids(ordered.data.purchases)).toEqual([second.id])

        const bySupplier = await api.get(
          `/admin/purchases?supplier_id=${supplierA.id}`,
          adminHeaders
        )
        expect(bySupplier.data.count).toBe(2)
        expect(ids(bySupplier.data.purchases)).toEqual([third.id, first.id])

        const none = await api.get(
          "/admin/purchases?supplier_id=sup_unknown",
          adminHeaders
        )
        expect(none.data.count).toBe(0)
        expect(none.data.purchases).toEqual([])

        const page = await api.get(
          "/admin/purchases?limit=1&offset=1",
          adminHeaders
        )
        expect(ids(page.data.purchases)).toEqual([second.id])
        expect(page.data.count).toBe(3)
      })

      it.each([
        ["status=bogus"],
        ["status=draft&status=ordered"],
        ["limit=abc"],
        ["limit=0"],
        ["limit=101"],
        ["offset=-1"],
        ["offset=abc"],
        ["supplier_id=a&supplier_id=b"],
      ])("GET /admin/purchases?%s returns 400", async (qs) => {
        const response = await api
          .get(`/admin/purchases?${qs}`, adminHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("GET /admin/purchases/:id returns items, totals and supplier", async () => {
        const supplier = await createSupplier("Acme")
        const variantA = await createVariant("Shirt A")
        const variantB = await createVariant("Shirt B")
        const created = await createPurchase({
          supplier_id: supplier.id,
          items: [
            { variant_id: variantA.id, quantity: 3, unit_cost: 4.1 },
            { variant_id: variantB.id, quantity: 2, unit_cost: 10 },
          ],
          shipping_cost: 3,
          other_cost: 1.5,
        })

        const response = await api.get(
          `/admin/purchases/${created.id}`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        const purchase = response.data.purchase
        expect(purchase.id).toBe(created.id)
        expect(purchase.reference).toBe(created.reference)
        expect(purchase.supplier).toEqual({ id: supplier.id, name: "Acme" })
        expect(purchase.items).toHaveLength(2)
        expect(purchase.subtotal).toBe(32.3)
        expect(purchase.total).toBe(36.8)
        expect(purchase.shipping_cost).toBe(3)
        expect(purchase.other_cost).toBe(1.5)
        expect(purchase.tax).toBe(0)
      })

      it("detail still shows the captured sku and title after the variant is renamed", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant("Original Title")
        const created = await createPurchase({
          supplier_id: supplier.id,
          items: [{ variant_id: variant.id, quantity: 1, unit_cost: 1 }],
        })

        const productModule = getContainer().resolve(Modules.PRODUCT) as any
        await productModule.updateProductVariants(variant.id, {
          title: "Renamed Title",
          sku: "RENAMED-SKU",
        })

        const response = await api.get(
          `/admin/purchases/${created.id}`,
          adminHeaders
        )
        expect(response.data.purchase.items[0].title).toBe("Original Title")
        expect(response.data.purchase.items[0].sku).toBe(variant.sku)
      })

      it("GET unknown id returns 404", async () => {
        const response = await api
          .get("/admin/purchases/pur_missing", adminHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(404)
      })
      describe("POST /admin/purchases/:id", () => {
        it("replaces items and updates costs on a draft", async () => {
          const supplier = await createSupplier("Acme")
          const variantA = await createVariant("Shirt A")
          const variantB = await createVariant("Shirt B")
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: variantA.id, quantity: 3, unit_cost: 4 }],
            shipping_cost: 5,
            notes: "before",
          })

          const response = await api.post(
            `/admin/purchases/${created.id}`,
            {
              items: [
                { variant_id: variantB.id, quantity: 2, unit_cost: 10 },
                { variant_id: variantA.id, quantity: 1, unit_cost: 7.5 },
              ],
              shipping_cost: 2,
              tax: 1.5,
              other_cost: 0.5,
              notes: "after",
            },
            adminHeaders
          )

          expect(response.status).toBe(200)
          const purchase = response.data.purchase
          expect(purchase.id).toBe(created.id)
          expect(purchase.status).toBe("draft")
          expect(purchase.supplier).toEqual({ id: supplier.id, name: "Acme" })
          expect(purchase.items).toHaveLength(2)
          expect(purchase.items.map((i: any) => i.variant_id).sort()).toEqual(
            [variantA.id, variantB.id].sort()
          )
          expect(
            purchase.items.find((i: any) => i.variant_id === variantB.id)
          ).toMatchObject({
            sku: variantB.sku,
            title: variantB.title,
            quantity: 2,
            unit_cost: 10,
          })
          expect(purchase.subtotal).toBe(27.5)
          expect(purchase.shipping_cost).toBe(2)
          expect(purchase.tax).toBe(1.5)
          expect(purchase.other_cost).toBe(0.5)
          expect(purchase.total).toBe(31.5)
          expect(purchase.notes).toBe("after")

          const fetched = await api.get(
            `/admin/purchases/${created.id}`,
            adminHeaders
          )
          expect(fetched.data.purchase.items).toHaveLength(2)
          expect(fetched.data.purchase.total).toBe(31.5)

          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          const stored = await purchaseModule.listPurchaseItems({
            purchase_id: created.id,
          })
          expect(stored).toHaveLength(2)

          const query = getContainer().resolve("query") as any
          const { data: linked } = await query.graph({
            entity: "purchase_item",
            fields: ["id", "product_variant.id"],
            filters: { id: purchase.items.map((i: any) => i.id) },
          })
          expect(linked.map((i: any) => i.product_variant.id).sort()).toEqual(
            [variantA.id, variantB.id].sort()
          )
          // Checked on the link itself: the old item row is deleted, so a
          // query through the item would be empty even with an orphaned link.
          expect(await linksForItem(created.items[0].id)).toEqual([])
          for (const item of purchase.items) {
            expect(await linksForItem(item.id)).toHaveLength(1)
          }
        })

        it("updates only costs and notes when items are omitted", async () => {
          const supplier = await createSupplier("Acme")
          const variant = await createVariant()
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: variant.id, quantity: 2, unit_cost: 3 }],
          })

          const response = await api.post(
            `/admin/purchases/${created.id}`,
            { tax: 4 },
            adminHeaders
          )

          expect(response.status).toBe(200)
          expect(response.data.purchase.items).toHaveLength(1)
          expect(response.data.purchase.items[0].id).toBe(created.items[0].id)
          expect(response.data.purchase.subtotal).toBe(6)
          expect(response.data.purchase.total).toBe(10)
        })

        it("rejects with 400 once the purchase is ordered", async () => {
          const supplier = await createSupplier("Acme")
          const variant = await createVariant()
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: variant.id, quantity: 2, unit_cost: 3 }],
          })
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          await purchaseModule.updatePurchases({
            id: created.id,
            status: "ordered",
          })

          const response = await api
            .post(
              `/admin/purchases/${created.id}`,
              { shipping_cost: 99 },
              adminHeaders
            )
            .catch((e) => e.response)

          expect(response.status).toBe(400)
          const fetched = await api.get(
            `/admin/purchases/${created.id}`,
            adminHeaders
          )
          expect(fetched.data.purchase.shipping_cost).toBe(0)
          expect(fetched.data.purchase.items).toHaveLength(1)
        })

        it("rejects an unknown variant with 404 and leaves the old items untouched", async () => {
          const supplier = await createSupplier("Acme")
          const variant = await createVariant()
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: variant.id, quantity: 2, unit_cost: 3 }],
            shipping_cost: 1,
            notes: "keep",
          })

          const response = await api
            .post(
              `/admin/purchases/${created.id}`,
              {
                items: [
                  { variant_id: "variant_missing", quantity: 1, unit_cost: 1 },
                ],
                shipping_cost: 50,
                notes: "changed",
              },
              adminHeaders
            )
            .catch((e) => e.response)

          expect(response.status).toBe(404)
          const fetched = (
            await api.get(`/admin/purchases/${created.id}`, adminHeaders)
          ).data.purchase
          expect(fetched.items).toHaveLength(1)
          expect(fetched.items[0]).toMatchObject({
            id: created.items[0].id,
            variant_id: variant.id,
            quantity: 2,
            unit_cost: 3,
          })
          expect(fetched.shipping_cost).toBe(1)
          expect(fetched.notes).toBe("keep")
          expect(fetched.total).toBe(7)

          // The old item-variant link is still in place.
          const query = getContainer().resolve("query") as any
          const { data } = await query.graph({
            entity: "purchase_item",
            fields: ["id", "product_variant.id"],
            filters: { id: created.items[0].id },
          })
          expect(data[0].product_variant.id).toBe(variant.id)
        })

        it("restores the old items, costs and links when a later step fails", async () => {
          const supplier = await createSupplier("Acme")
          const variantA = await createVariant("Shirt A")
          const variantB = await createVariant("Shirt B")
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [
              { variant_id: variantA.id, quantity: 3, unit_cost: 4.25 },
              { variant_id: variantB.id, quantity: 2, unit_cost: 10 },
            ],
            shipping_cost: 5,
            tax: 1.5,
            other_cost: 2,
            notes: "keep me",
          })
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          await purchaseModule.updatePurchaseItems({
            id: created.items[0].id,
            quantity_received: 1,
          })
          const before = (
            await api.get(`/admin/purchases/${created.id}`, adminHeaders)
          ).data.purchase

          const variantC = await createVariant("Shirt C")

          // Fail the link creation, which runs after the items and costs
          // were already replaced. Later create calls (the compensation of
          // the dismiss step restoring the old links) go through.
          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          const spy = jest
            .spyOn(link, "create")
            .mockRejectedValueOnce(new Error("link create failed"))

          const response = await api
            .post(
              `/admin/purchases/${created.id}`,
              {
                items: [{ variant_id: variantC.id, quantity: 9, unit_cost: 1 }],
                shipping_cost: 50,
                tax: 40,
                other_cost: 30,
                notes: "changed",
              },
              adminHeaders
            )
            .catch((e) => e.response)
          spy.mockRestore()

          expect(response.status).toBe(500)

          const after = (
            await api.get(`/admin/purchases/${created.id}`, adminHeaders)
          ).data.purchase
          expect(after.items).toHaveLength(2)
          const byId = (p: any, id: string) =>
            p.items.find((i: any) => i.id === id)
          expect(byId(after, created.items[0].id)).toMatchObject({
            variant_id: variantA.id,
            sku: variantA.sku,
            title: variantA.title,
            quantity: 3,
            quantity_received: 1,
            unit_cost: 4.25,
          })
          expect(byId(after, created.items[1].id)).toMatchObject({
            variant_id: variantB.id,
            quantity: 2,
            quantity_received: 0,
            unit_cost: 10,
          })
          expect(after.shipping_cost).toBe(5)
          expect(after.tax).toBe(1.5)
          expect(after.other_cost).toBe(2)
          expect(after.notes).toBe("keep me")
          expect(after.total).toBe(before.total)

          expect(await linksForItem(created.items[0].id)).toEqual([
            expect.objectContaining({ product_variant_id: variantA.id }),
          ])
          expect(await linksForItem(created.items[1].id)).toEqual([
            expect.objectContaining({ product_variant_id: variantB.id }),
          ])
        })

        it("unknown purchase id returns 404", async () => {
          const response = await api
            .post("/admin/purchases/pur_missing", { notes: "x" }, adminHeaders)
            .catch((e) => e.response)

          expect(response.status).toBe(404)
        })

        it.each([
          ["empty items", { items: [] }],
          [
            "quantity 0",
            { items: [{ variant_id: "v", quantity: 0, unit_cost: 1 }] },
          ],
          ["negative tax", { tax: -1 }],
        ])("rejects %s with 400", async (_name, body) => {
          const supplier = await createSupplier("Acme")
          const variant = await createVariant()
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: variant.id, quantity: 1, unit_cost: 1 }],
          })

          const response = await api
            .post(`/admin/purchases/${created.id}`, body, adminHeaders)
            .catch((e) => e.response)

          expect(response.status).toBe(400)
        })
      })
    })
  },
})
