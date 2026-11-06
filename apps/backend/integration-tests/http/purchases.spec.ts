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
      it("POST rejects an inactive supplier with 400 mentioning inactive and writes nothing", async () => {
        const supplier = await createSupplier("Dormant")
        await api.post(
          `/admin/suppliers/${supplier.id}`,
          { is_active: false },
          adminHeaders
        )
        const variant = await createVariant()

        const response = await api
          .post(
            "/admin/purchases",
            {
              supplier_id: supplier.id,
              items: [{ variant_id: variant.id, quantity: 1, unit_cost: 1 }],
            },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("inactive")
        expect(await countPurchases()).toBe(0)
      })

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

      describe("POST /admin/purchases/:id/order and /cancel", () => {
        const draftPurchase = async () => {
          const supplier = await createSupplier("Acme")
          const variant = await createVariant()
          return createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: variant.id, quantity: 4, unit_cost: 2 }],
          })
        }

        const post = (path: string) =>
          api.post(path, {}, adminHeaders).catch((e) => e.response)

        const setState = async (id: string, data: Record<string, unknown>) => {
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          await purchaseModule.updatePurchases({ id, ...data })
        }

        const fetchPurchase = async (id: string) =>
          (await api.get(`/admin/purchases/${id}`, adminHeaders)).data.purchase

        it("POST /:id/order moves draft to ordered and sets ordered_at", async () => {
          const created = await draftPurchase()
          expect(created.ordered_at).toBeNull()

          const before = Date.now()
          const response = await post(`/admin/purchases/${created.id}/order`)

          expect(response.status).toBe(200)
          expect(response.data.purchase.id).toBe(created.id)
          expect(response.data.purchase.status).toBe("ordered")
          expect(response.data.purchase.items).toHaveLength(1)
          expect(response.data.purchase.supplier.name).toBe("Acme")
          const orderedAt = new Date(response.data.purchase.ordered_at)
          expect(orderedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
          expect(orderedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000)

          const fetched = await fetchPurchase(created.id)
          expect(fetched.status).toBe("ordered")
          expect(fetched.ordered_at).toBe(response.data.purchase.ordered_at)
        })

        it("order rejects a draft with no items (400)", async () => {
          const created = await draftPurchase()
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          await purchaseModule.deletePurchaseItems([created.items[0].id])

          const response = await post(`/admin/purchases/${created.id}/order`)

          expect(response.status).toBe(400)
          const fetched = await fetchPurchase(created.id)
          expect(fetched.status).toBe("draft")
          expect(fetched.ordered_at).toBeNull()
        })

        it("order rejects a purchase that is not draft (400)", async () => {
          const created = await draftPurchase()
          const first = await post(`/admin/purchases/${created.id}/order`)
          expect(first.status).toBe(200)

          const second = await post(`/admin/purchases/${created.id}/order`)

          expect(second.status).toBe(400)
          const fetched = await fetchPurchase(created.id)
          expect(fetched.status).toBe("ordered")
          expect(fetched.ordered_at).toBe(first.data.purchase.ordered_at)
        })

        it("order on an unknown id returns 404", async () => {
          const response = await post("/admin/purchases/pur_missing/order")

          expect(response.status).toBe(404)
        })

        it("POST /:id/cancel cancels a draft and an ordered purchase", async () => {
          const draft = await draftPurchase()
          const cancelledDraft = await post(`/admin/purchases/${draft.id}/cancel`)
          expect(cancelledDraft.status).toBe(200)
          expect(cancelledDraft.data.purchase.id).toBe(draft.id)
          expect(cancelledDraft.data.purchase.status).toBe("cancelled")
          expect(cancelledDraft.data.purchase.ordered_at).toBeNull()
          expect((await fetchPurchase(draft.id)).status).toBe("cancelled")

          const ordered = await draftPurchase()
          const placed = await post(`/admin/purchases/${ordered.id}/order`)
          const cancelledOrdered = await post(
            `/admin/purchases/${ordered.id}/cancel`
          )
          expect(cancelledOrdered.status).toBe(200)
          expect(cancelledOrdered.data.purchase.status).toBe("cancelled")
          // History is kept: ordered_at is not cleared by cancelling.
          expect(cancelledOrdered.data.purchase.ordered_at).toBe(
            placed.data.purchase.ordered_at
          )
          expect((await fetchPurchase(ordered.id)).status).toBe("cancelled")
        })

        it("cancel rejects once any quantity_received > 0 (400)", async () => {
          const created = await draftPurchase()
          const placed = await post(`/admin/purchases/${created.id}/order`)
          await setState(created.id, { status: "partially_received" })
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          await purchaseModule.updatePurchaseItems({
            id: created.items[0].id,
            quantity_received: 1,
          })

          const response = await post(`/admin/purchases/${created.id}/cancel`)

          expect(response.status).toBe(400)
          const fetched = await fetchPurchase(created.id)
          expect(fetched.status).toBe("partially_received")
          expect(fetched.ordered_at).toBe(placed.data.purchase.ordered_at)
          expect(fetched.items[0].quantity_received).toBe(1)
        })

        it("cancel rejects an ordered purchase when any item has quantity_received > 0 (400)", async () => {
          const supplier = await createSupplier("Acme")
          const variantA = await createVariant("Shirt A")
          const variantB = await createVariant("Shirt B")
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: [
              { variant_id: variantA.id, quantity: 3, unit_cost: 2 },
              { variant_id: variantB.id, quantity: 5, unit_cost: 2 },
            ],
          })
          const placed = await post(`/admin/purchases/${created.id}/order`)
          expect(placed.status).toBe(200)
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          // Only the second item has received goods, status stays ordered so
          // the received-quantity guard (not the status check) must reject.
          const second = created.items.find(
            (i: any) => i.variant_id === variantB.id
          )
          const first = created.items.find(
            (i: any) => i.variant_id === variantA.id
          )
          await purchaseModule.updatePurchaseItems({
            id: second.id,
            quantity_received: 1,
          })

          const response = await post(`/admin/purchases/${created.id}/cancel`)

          expect(response.status).toBe(400)
          const fetched = await fetchPurchase(created.id)
          expect(fetched.status).toBe("ordered")
          expect(fetched.ordered_at).toBe(placed.data.purchase.ordered_at)
          const byId = (id: string) =>
            fetched.items.find((i: any) => i.id === id)
          expect(byId(first.id).quantity_received).toBe(0)
          expect(byId(second.id).quantity_received).toBe(1)
          expect(byId(second.id).quantity).toBe(5)
        })

        it("cancel rejects a received or already cancelled purchase (400)", async () => {
          const received = await draftPurchase()
          await setState(received.id, { status: "received" })
          const receivedResponse = await post(
            `/admin/purchases/${received.id}/cancel`
          )
          expect(receivedResponse.status).toBe(400)
          expect((await fetchPurchase(received.id)).status).toBe("received")

          const cancelled = await draftPurchase()
          expect(
            (await post(`/admin/purchases/${cancelled.id}/cancel`)).status
          ).toBe(200)
          const again = await post(`/admin/purchases/${cancelled.id}/cancel`)
          expect(again.status).toBe(400)
          expect((await fetchPurchase(cancelled.id)).status).toBe("cancelled")
        })

        it("cancel on an unknown id returns 404", async () => {
          const response = await post("/admin/purchases/pur_missing/cancel")

          expect(response.status).toBe(404)
        })
      })

      describe("POST /admin/purchases/:id/receive", () => {
        const createStockLocation = async (name = "Main warehouse") =>
          (
            await api.post("/admin/stock-locations", { name }, adminHeaders)
          ).data.stock_location as { id: string }

        // A variant with manage_inventory: true gets its own inventory item
        // from the product workflow.
        const createStockedVariant = async (title = "Stocked Shirt") => {
          counter += 1
          const product = (
            await api.post(
              "/admin/products",
              {
                title: `Stocked product ${counter}`,
                options: [{ title: "size", values: ["large"] }],
                variants: [
                  {
                    title,
                    sku: `STOCK-${counter}`,
                    manage_inventory: true,
                    prices: [{ currency_code: "usd", amount: 100 }],
                    options: { size: "large" },
                  },
                ],
              },
              adminHeaders
            )
          ).data.product
          const variant = product.variants[0] as { id: string; title: string }

          const query = getContainer().resolve("query") as any
          const { data } = await query.graph({
            entity: "product_variant",
            fields: ["id", "inventory_items.inventory_item_id"],
            filters: { id: variant.id },
          })
          const inventoryItemId = data[0].inventory_items[0]
            .inventory_item_id as string
          expect(inventoryItemId).toBeTruthy()

          return { ...variant, inventory_item_id: inventoryItemId }
        }

        const setStock = async (
          inventoryItemId: string,
          locationId: string,
          stockedQuantity: number
        ) => {
          await api.post(
            `/admin/inventory-items/${inventoryItemId}/location-levels`,
            { location_id: locationId, stocked_quantity: stockedQuantity },
            adminHeaders
          )
        }

        // undefined means the location has no inventory level for the item.
        const stockedAt = async (inventoryItemId: string, locationId: string) => {
          const inventoryModule = getContainer().resolve(
            Modules.INVENTORY
          ) as any
          const levels = await inventoryModule.listInventoryLevels({
            inventory_item_id: inventoryItemId,
            location_id: locationId,
          })
          expect(levels.length).toBeLessThanOrEqual(1)
          return levels.length ? Number(levels[0].stocked_quantity) : undefined
        }

        const orderedPurchase = async (
          lines: { variant_id: string; quantity: number }[]
        ) => {
          const supplier = await createSupplier("Acme")
          const created = await createPurchase({
            supplier_id: supplier.id,
            items: lines.map((line) => ({ ...line, unit_cost: 2 })),
          })
          const placed = await api.post(
            `/admin/purchases/${created.id}/order`,
            {},
            adminHeaders
          )
          expect(placed.status).toBe(200)
          return placed.data.purchase as {
            id: string
            items: { id: string; variant_id: string }[]
          }
        }

        const itemFor = (
          purchase: { items: { id: string; variant_id: string }[] },
          variantId: string
        ) => purchase.items.find((i) => i.variant_id === variantId)!.id

        const receive = (purchaseId: string, body: Record<string, unknown>) =>
          api
            .post(`/admin/purchases/${purchaseId}/receive`, body, adminHeaders)
            .catch((e) => e.response)

        const fetchPurchase = async (id: string) =>
          (await api.get(`/admin/purchases/${id}`, adminHeaders)).data.purchase

        const receiptRows = async (purchaseId: string) => {
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          const receipts = await purchaseModule.listPurchaseReceipts({
            purchase_id: purchaseId,
          })
          const items = receipts.length
            ? await purchaseModule.listPurchaseReceiptItems({
                receipt_id: receipts.map((r: any) => r.id),
              })
            : []
          return { receipts, items }
        }

        const allReceiptRowCounts = async () => {
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          const [, receipts] = await purchaseModule.listAndCountPurchaseReceipts(
            {}
          )
          const [, items] =
            await purchaseModule.listAndCountPurchaseReceiptItems({})
          return { receipts, items }
        }

        const stockLocationLinks = async (receiptId: string) => {
          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          const linkModule = link.getLinkModule(
            "purchase",
            "purchase_receipt_id",
            Modules.STOCK_LOCATION,
            "stock_location_id"
          )
          return (await linkModule.list({
            purchase_receipt_id: receiptId,
          })) as { purchase_receipt_id: string; stock_location_id: string }[]
        }

        const allStockLocationLinkCount = async () => {
          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          const linkModule = link.getLinkModule(
            "purchase",
            "purchase_receipt_id",
            Modules.STOCK_LOCATION,
            "stock_location_id"
          )
          return ((await linkModule.list({})) as unknown[]).length
        }

        it("partial delivery raises stock by the received quantity, records the receipt, links the receipt to the stock location, sets partially_received", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant("Shirt A")
          const hat = await createStockedVariant("Hat B")
          await setStock(shirt.inventory_item_id, location.id, 7)
          await setStock(hat.inventory_item_id, location.id, 1)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 10 },
            { variant_id: hat.id, quantity: 4 },
          ])
          const shirtItem = itemFor(purchase, shirt.id)
          const hatItem = itemFor(purchase, hat.id)

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [
              { purchase_item_id: shirtItem, quantity: 3 },
              { purchase_item_id: hatItem, quantity: 4 },
            ],
            note: "first box",
          })

          expect(response.status).toBe(200)
          const body = response.data.purchase
          expect(body.id).toBe(purchase.id)
          expect(body.status).toBe("partially_received")
          const byId = (id: string) => body.items.find((i: any) => i.id === id)
          expect(byId(shirtItem)).toMatchObject({
            quantity: 10,
            quantity_received: 3,
            remaining: 7,
          })
          expect(byId(hatItem)).toMatchObject({
            quantity: 4,
            quantity_received: 4,
            remaining: 0,
          })
          expect(body.receipts).toHaveLength(1)
          expect(body.receipts[0]).toMatchObject({
            stock_location_id: location.id,
            note: "first box",
          })
          expect(
            body.receipts[0].items.sort((a: any, b: any) =>
              a.quantity - b.quantity
            )
          ).toEqual([
            { purchase_item_id: shirtItem, quantity: 3 },
            { purchase_item_id: hatItem, quantity: 4 },
          ])
          expect(response.data.receipt.id).toBe(body.receipts[0].id)

          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(10)
          expect(await stockedAt(hat.inventory_item_id, location.id)).toBe(5)

          const rows = await receiptRows(purchase.id)
          expect(rows.receipts).toHaveLength(1)
          expect(rows.items).toHaveLength(2)
          expect(await stockLocationLinks(rows.receipts[0].id)).toEqual([
            expect.objectContaining({ stock_location_id: location.id }),
          ])

          const fetched = await fetchPurchase(purchase.id)
          expect(fetched.status).toBe("partially_received")
          expect(fetched.receipts).toHaveLength(1)
        })

        it("a second delivery completing the order sets received", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 2)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])
          const item = itemFor(purchase, shirt.id)

          const first = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: item, quantity: 2 }],
          })
          expect(first.status).toBe(200)
          expect(first.data.purchase.status).toBe("partially_received")

          const second = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: item, quantity: 3 }],
          })

          expect(second.status).toBe(200)
          expect(second.data.purchase.status).toBe("received")
          expect(second.data.purchase.items[0]).toMatchObject({
            quantity_received: 5,
            remaining: 0,
          })
          expect(second.data.purchase.receipts).toHaveLength(2)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(7)
          const rows = await receiptRows(purchase.id)
          expect(rows.receipts).toHaveLength(2)
          expect(
            rows.items.map((i: any) => i.quantity).sort()
          ).toEqual([2, 3])
        })

        it("rejects receiving more than the remaining quantity (400), naming the item and the remaining number; stock and records unchanged", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant("Remaining Shirt")
          await setStock(shirt.inventory_item_id, location.id, 4)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])
          const item = itemFor(purchase, shirt.id)
          const first = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: item, quantity: 2 }],
          })
          expect(first.status).toBe(200)

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: item, quantity: 4 }],
          })

          expect(response.status).toBe(400)
          expect(response.data.message).toContain("Remaining Shirt")
          expect(response.data.message).toContain("only 3 remaining")
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(6)
          const fetched = await fetchPurchase(purchase.id)
          expect(fetched.status).toBe("partially_received")
          expect(fetched.items[0].quantity_received).toBe(2)
          const rows = await receiptRows(purchase.id)
          expect(rows.receipts).toHaveLength(1)
          expect(rows.items).toHaveLength(1)
          expect(await allStockLocationLinkCount()).toBe(1)
        })

        it("rejects a draft, cancelled or already received purchase (400)", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 0)
          const supplier = await createSupplier("Acme")
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any

          const draft = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: shirt.id, quantity: 3, unit_cost: 1 }],
          })
          const cancelled = await createPurchase({
            supplier_id: supplier.id,
            items: [{ variant_id: shirt.id, quantity: 3, unit_cost: 1 }],
          })
          expect(
            (
              await api.post(
                `/admin/purchases/${cancelled.id}/cancel`,
                {},
                adminHeaders
              )
            ).status
          ).toBe(200)
          const received = await orderedPurchase([
            { variant_id: shirt.id, quantity: 3 },
          ])
          const completed = await receive(received.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: received.items[0].id, quantity: 3 }],
          })
          expect(completed.status).toBe(200)
          expect(completed.data.purchase.status).toBe("received")
          // Leave room to receive so only the status can reject it.
          await purchaseModule.updatePurchaseItems({
            id: received.items[0].id,
            quantity_received: 1,
          })
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(3)
          const countsBefore = await allReceiptRowCounts()

          for (const [purchase, status] of [
            [draft, "draft"],
            [cancelled, "cancelled"],
            [received, "received"],
          ] as const) {
            const response = await receive(purchase.id, {
              stock_location_id: location.id,
              items: [{ purchase_item_id: purchase.items[0].id, quantity: 1 }],
            })
            expect(response.status).toBe(400)
            expect(response.data.message).toContain(`a ${status} purchase`)
            expect((await fetchPurchase(purchase.id)).status).toBe(status)
          }

          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(3)
          expect(await allReceiptRowCounts()).toEqual(countsBefore)
        })

        it("rejects a variant with manage_inventory false (400) and changes nothing", async () => {
          const location = await createStockLocation()
          const stocked = await createStockedVariant("Stocked One")
          await setStock(stocked.inventory_item_id, location.id, 2)
          const unmanaged = await createVariant("Unmanaged Sticker")
          const purchase = await orderedPurchase([
            { variant_id: stocked.id, quantity: 5 },
            { variant_id: unmanaged.id, quantity: 5 },
          ])

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [
              { purchase_item_id: itemFor(purchase, stocked.id), quantity: 1 },
              { purchase_item_id: itemFor(purchase, unmanaged.id), quantity: 1 },
            ],
          })

          expect(response.status).toBe(400)
          expect(response.data.type).toBe("invalid_data")
          expect(response.data.message).toContain("Unmanaged Sticker")
          expect(response.data.message).toContain("does not manage inventory")
          expect(await stockedAt(stocked.inventory_item_id, location.id)).toBe(2)
          const fetched = await fetchPurchase(purchase.id)
          expect(fetched.status).toBe("ordered")
          expect(
            fetched.items.map((i: any) => i.quantity_received)
          ).toEqual([0, 0])
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
          expect(await allStockLocationLinkCount()).toBe(0)
        })

        it("rejects a variant with no inventory item (400) and changes nothing", async () => {
          const location = await createStockLocation()
          const orphan = await createStockedVariant("Orphan Mug")
          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          await link.dismiss({
            [Modules.PRODUCT]: { variant_id: orphan.id },
            [Modules.INVENTORY]: { inventory_item_id: orphan.inventory_item_id },
          })
          const purchase = await orderedPurchase([
            { variant_id: orphan.id, quantity: 5 },
          ])

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: purchase.items[0].id, quantity: 2 }],
          })

          expect(response.status).toBe(400)
          expect(response.data.type).toBe("invalid_data")
          expect(response.data.message).toContain("Orphan Mug")
          expect(response.data.message).toContain("no inventory item")
          // No level was created at the location for the orphaned item.
          expect(
            await stockedAt(orphan.inventory_item_id, location.id)
          ).toBeUndefined()
          const fetched = await fetchPurchase(purchase.id)
          expect(fetched.status).toBe("ordered")
          expect(fetched.items[0].quantity_received).toBe(0)
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
        })

        it("rejects an unknown stock location (404) and changes nothing", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 1)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])

          const response = await receive(purchase.id, {
            stock_location_id: "sloc_missing",
            items: [{ purchase_item_id: purchase.items[0].id, quantity: 2 }],
          })

          expect(response.status).toBe(404)
          expect(
            await stockedAt(shirt.inventory_item_id, "sloc_missing")
          ).toBeUndefined()
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(1)
          const fetched = await fetchPurchase(purchase.id)
          expect(fetched.status).toBe("ordered")
          expect(fetched.items[0].quantity_received).toBe(0)
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
        })

        it("unknown purchase id returns 404", async () => {
          const location = await createStockLocation()

          const response = await receive("pur_missing", {
            stock_location_id: location.id,
            items: [{ purchase_item_id: "pitem_x", quantity: 1 }],
          })

          expect(response.status).toBe(404)
        })

        it.each([
          ["empty items", { items: [] }],
          ["quantity 0", { items: [{ purchase_item_id: "x", quantity: 0 }] }],
          ["quantity 1.5", { items: [{ purchase_item_id: "x", quantity: 1.5 }] }],
          [
            "missing stock_location_id",
            {
              stock_location_id: undefined,
              items: [{ purchase_item_id: "x", quantity: 1 }],
            },
          ],
        ])("rejects %s with 400", async (_name, body) => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            ...body,
          })

          expect(response.status).toBe(400)
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
        })

        it("creates the inventory level when the location has none, ending at the received quantity", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 8 },
          ])
          expect(
            await stockedAt(shirt.inventory_item_id, location.id)
          ).toBeUndefined()

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: purchase.items[0].id, quantity: 6 }],
          })

          expect(response.status).toBe(200)
          expect(response.data.purchase.status).toBe("partially_received")
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(6)
        })

        it("two simultaneous receives that together exceed remaining: exactly one 200 and one 400, stock rises once, quantity_received equals the accepted quantity", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 10)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])
          const item = purchase.items[0].id

          const responses = await Promise.all([
            receive(purchase.id, {
              stock_location_id: location.id,
              items: [{ purchase_item_id: item, quantity: 3 }],
            }),
            receive(purchase.id, {
              stock_location_id: location.id,
              items: [{ purchase_item_id: item, quantity: 4 }],
            }),
          ])

          const statuses = responses.map((r) => r.status).sort()
          expect(statuses).toEqual([200, 400])
          const accepted = responses.find((r) => r.status === 200)!
          const acceptedQuantity = accepted.data.purchase.receipts[0].items[0]
            .quantity as number
          expect([3, 4]).toContain(acceptedQuantity)

          const fetched = await fetchPurchase(purchase.id)
          expect(fetched.status).toBe("partially_received")
          expect(fetched.items[0].quantity_received).toBe(acceptedQuantity)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(
            10 + acceptedQuantity
          )
          const rows = await receiptRows(purchase.id)
          expect(rows.receipts).toHaveLength(1)
          expect(rows.items).toHaveLength(1)
          expect(rows.items[0].quantity).toBe(acceptedQuantity)
          expect(await allStockLocationLinkCount()).toBe(1)
        })

        it("a failure after the receipt is recorded rolls everything back", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          const hat = await createStockedVariant("Hat")
          await setStock(shirt.inventory_item_id, location.id, 9)
          // The hat has no level at this location: the rollback must also
          // remove the level the workflow created for it.
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
            { variant_id: hat.id, quantity: 2 },
          ])
          const shirtItem = itemFor(purchase, shirt.id)
          const hatItem = itemFor(purchase, hat.id)
          const first = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: shirtItem, quantity: 1 }],
          })
          expect(first.status).toBe(200)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(10)
          const before = await fetchPurchase(purchase.id)
          expect(before.status).toBe("partially_received")

          // The stock adjustment is the last step: everything before it
          // (level creation, receipt, quantities, status, link) has been
          // written when it fails.
          const inventoryModule = getContainer().resolve(
            Modules.INVENTORY
          ) as any
          const spy = jest
            .spyOn(inventoryModule, "adjustInventory")
            .mockRejectedValueOnce(new Error("adjust failed"))

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [
              { purchase_item_id: shirtItem, quantity: 4 },
              { purchase_item_id: hatItem, quantity: 2 },
            ],
          })
          const adjustCalls = spy.mock.calls.length
          spy.mockRestore()

          expect(adjustCalls).toBe(1)
          expect(response.status).toBe(500)

          const after = await fetchPurchase(purchase.id)
          expect(after.status).toBe("partially_received")
          const byId = (id: string) => after.items.find((i: any) => i.id === id)
          expect(byId(shirtItem).quantity_received).toBe(1)
          expect(byId(hatItem).quantity_received).toBe(0)
          expect(after.receipts).toHaveLength(1)
          expect(after.receipts[0].id).toBe(before.receipts[0].id)

          const rows = await receiptRows(purchase.id)
          expect(rows.receipts).toHaveLength(1)
          expect(rows.items).toHaveLength(1)
          expect(await allStockLocationLinkCount()).toBe(1)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(10)
          expect(
            await stockedAt(hat.inventory_item_id, location.id)
          ).toBeUndefined()
        })

        it("a rollback keeps a level it created once that level holds stock from elsewhere", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])
          expect(
            await stockedAt(shirt.inventory_item_id, location.id)
          ).toBeUndefined()

          // The link step runs after this request created the level and
          // recorded its receipt. Stock arrives at that level out-of-band
          // before the link step fails.
          const inventoryModule = getContainer().resolve(
            Modules.INVENTORY
          ) as any
          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          let levelSeen: number | undefined
          const spy = jest
            .spyOn(link, "create")
            .mockImplementationOnce(async () => {
              levelSeen = await stockedAt(shirt.inventory_item_id, location.id)
              await inventoryModule.adjustInventory(
                shirt.inventory_item_id,
                location.id,
                4
              )
              throw new Error("link create failed")
            })

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: purchase.items[0].id, quantity: 2 }],
          })
          spy.mockRestore()

          expect(levelSeen).toBe(0)
          expect(response.status).toBe(500)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(4)
          const after = await fetchPurchase(purchase.id)
          expect(after.status).toBe("ordered")
          expect(after.items[0].quantity_received).toBe(0)
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
          expect(await allStockLocationLinkCount()).toBe(0)
        })

        it("a receive that created the level and then fails does not remove stock a concurrent receive put on it", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])
          const item = purchase.items[0].id

          // Request A creates the level, records its receipt, then reaches
          // the link step. Request B runs to completion right there: it finds
          // the level A created, creates none, and stocks it. Then A fails.
          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          let second: any
          const spy = jest
            .spyOn(link, "create")
            .mockImplementationOnce(async () => {
              second = await receive(purchase.id, {
                stock_location_id: location.id,
                items: [{ purchase_item_id: item, quantity: 3 }],
              })
              throw new Error("link create failed")
            })

          const first = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: item, quantity: 2 }],
          })
          spy.mockRestore()

          expect(second.status).toBe(200)
          expect(first.status).toBe(500)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(3)
          const after = await fetchPurchase(purchase.id)
          expect(after.status).toBe("partially_received")
          expect(after.items[0].quantity_received).toBe(3)
          const rows = await receiptRows(purchase.id)
          expect(rows.receipts).toHaveLength(1)
          expect(rows.receipts[0].id).toBe(second.data.receipt.id)
          expect(rows.items.map((i: any) => i.quantity)).toEqual([3])
          expect(await allStockLocationLinkCount()).toBe(1)
        })

        it("a cancel and a receive racing on an ordered purchase never leave a cancelled purchase with receipts or raised stock", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 6)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])

          // Force the dangerous interleaving: the cancel has read the purchase
          // (ordered, nothing received) and is about to write. A receive is
          // started right then and given time to finish before the cancel
          // write goes ahead. The wait stays below the 5s lock timeout, so a
          // receive blocked on the purchase lock is not timed out.
          const purchaseModule = getContainer().resolve(PURCHASE_MODULE) as any
          const updatePurchases = purchaseModule.updatePurchases.bind(
            purchaseModule
          )
          let receiving: Promise<any> | undefined
          const spy = jest
            .spyOn(purchaseModule, "updatePurchases")
            .mockImplementationOnce(async (...args: any[]) => {
              receiving = receive(purchase.id, {
                stock_location_id: location.id,
                items: [{ purchase_item_id: purchase.items[0].id, quantity: 2 }],
              })
              await Promise.race([
                receiving,
                new Promise((resolve) => setTimeout(resolve, 3000)),
              ])
              return updatePurchases(...args)
            })

          const cancelled = await api
            .post(`/admin/purchases/${purchase.id}/cancel`, {}, adminHeaders)
            .catch((e) => e.response)
          spy.mockRestore()
          const received = await receiving!

          expect(cancelled.status).toBe(200)
          expect(received.status).toBe(400)
          expect(received.data.message).toContain("a cancelled purchase")
          const after = await fetchPurchase(purchase.id)
          expect(after.status).toBe("cancelled")
          expect(after.items[0].quantity_received).toBe(0)
          expect(after.receipts).toEqual([])
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
          expect(await allStockLocationLinkCount()).toBe(0)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(6)
        })

        it("a failure of the stock location link rolls back the receipt and restores the ordered status", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 3)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])

          const link = getContainer().resolve(
            ContainerRegistrationKeys.LINK
          ) as any
          const spy = jest
            .spyOn(link, "create")
            .mockRejectedValueOnce(new Error("link create failed"))

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: purchase.items[0].id, quantity: 5 }],
          })
          spy.mockRestore()

          expect(response.status).toBe(500)
          const after = await fetchPurchase(purchase.id)
          expect(after.status).toBe("ordered")
          expect(after.items[0].quantity_received).toBe(0)
          expect(after.receipts).toEqual([])
          expect(await allReceiptRowCounts()).toEqual({ receipts: 0, items: 0 })
          expect(await allStockLocationLinkCount()).toBe(0)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(3)
        })

        it("still receives goods on an existing purchase after its supplier is made inactive", async () => {
          const location = await createStockLocation()
          const shirt = await createStockedVariant()
          await setStock(shirt.inventory_item_id, location.id, 3)
          const purchase = await orderedPurchase([
            { variant_id: shirt.id, quantity: 5 },
          ])
          const supplierId = (await fetchPurchase(purchase.id)).supplier.id
          await api.post(
            `/admin/suppliers/${supplierId}`,
            { is_active: false },
            adminHeaders
          )

          const response = await receive(purchase.id, {
            stock_location_id: location.id,
            items: [{ purchase_item_id: purchase.items[0].id, quantity: 5 }],
          })

          expect(response.status).toBe(200)
          expect(await stockedAt(shirt.inventory_item_id, location.id)).toBe(8)
        })
      })
    })
  },
})
