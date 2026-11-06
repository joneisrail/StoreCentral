import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ACCOUNTING_MODULE } from "../../src/modules/accounting"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const adminHeaders = { headers: {} as Record<string, string> }
    let counter = 0

    beforeEach(async () => {
      await createAdminUser(getContainer(), adminHeaders)
    })

    const accounting = () => getContainer().resolve(ACCOUNTING_MODULE) as any

    const createSupplier = async (name: string) =>
      (await api.post("/admin/suppliers", { name }, adminHeaders)).data
        .supplier as { id: string; name: string }

    const createVariant = async (
      title = "Blue Shirt",
      manageInventory = false
    ) => {
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
                manage_inventory: manageInventory,
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

    const addSupplierProduct = async (
      supplierId: string,
      body: Record<string, unknown>
    ) =>
      (
        await api.post(
          `/admin/suppliers/${supplierId}/products`,
          body,
          adminHeaders
        )
      ).data.supplier_product

    const listSupplierProducts = async (supplierId: string) =>
      (await api.get(`/admin/suppliers/${supplierId}/products`, adminHeaders))
        .data.supplier_products as {
        id: string
        variant_id: string
        supplier_sku: string
      }[]

    const orderedPurchase = async (
      supplierId: string,
      lines: { variant_id: string; quantity: number; unit_cost: number }[]
    ) => {
      const created = (
        await api.post(
          "/admin/purchases",
          { supplier_id: supplierId, items: lines },
          adminHeaders
        )
      ).data.purchase
      const placed = await api.post(
        `/admin/purchases/${created.id}/order`,
        {},
        adminHeaders
      )
      return placed.data.purchase as {
        id: string
        reference: string
        items: { id: string; variant_id: string; title: string }[]
      }
    }

    const post = (body: Record<string, unknown>) =>
      api.post("/admin/invoices", body, adminHeaders).catch((e) => e.response)

    const countInvoices = async () => {
      const [, count] = await accounting().listAndCountInvoices({})
      return count as number
    }

    // A supplier with one listed product and an ordered purchase for it.
    const setup = async (supplierName = "Acme") => {
      const supplier = await createSupplier(supplierName)
      const variant = await createVariant("Blue Large")
      await addSupplierProduct(supplier.id, {
        variant_id: variant.id,
        supplier_sku: "AC-100",
        supplier_title: "Shirt blue L",
      })
      const purchase = await orderedPurchase(supplier.id, [
        { variant_id: variant.id, quantity: 10, unit_cost: 2 },
      ])
      return { supplier, variant, purchase }
    }

    const header = (purchaseId: string, over: Record<string, unknown> = {}) => ({
      purchase_id: purchaseId,
      invoice_number: "A-1",
      invoice_date: "2026-11-01",
      ...over,
    })

    describe("POST /admin/invoices", () => {
      it("resolves a supplier code (case and spaces ignored) to the variant and the purchase item", async () => {
        const { supplier, variant, purchase } = await setup()

        const response = await post(
          header(purchase.id, {
            due_date: "2026-12-01",
            shipping_cost: 5,
            tax: 1.25,
            other_cost: 0.5,
            notes: "first bill",
            items: [{ supplier_sku: "  ac-100 ", quantity: 4, unit_cost: 2.5 }],
          })
        )

        expect(response.status).toBe(200)
        const invoice = response.data.invoice
        expect(invoice).toMatchObject({
          reference: "INV-0001",
          status: "draft",
          invoice_number: "A-1",
          invoice_date: "2026-11-01",
          due_date: "2026-12-01",
          supplier: { id: supplier.id, name: "Acme" },
          purchase: { id: purchase.id, reference: purchase.reference },
          shipping_cost: 5,
          tax: 1.25,
          other_cost: 0.5,
          subtotal: 10,
          total: 16.75,
          notes: "first bill",
          posted_at: null,
          voided_at: null,
        })
        expect(invoice.items).toEqual([
          {
            id: expect.any(String),
            purchase_item_id: purchase.items[0].id,
            variant_id: variant.id,
            supplier_sku: "AC-100",
            description: purchase.items[0].title,
            quantity: 4,
            unit_cost: 2.5,
            line_total: 10,
          },
        ])

        // Links: invoice to purchase, item to variant.
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "invoice",
          fields: ["id", "purchase.id", "items.id", "items.product_variant.id"],
          filters: { id: invoice.id },
        })
        const row = data[0] as any
        expect(row.purchase.id).toBe(purchase.id)
        expect(row.items[0].product_variant.id).toBe(variant.id)
      })

      it("rejects an unknown code with 400 naming the code", async () => {
        const { purchase } = await setup()

        const response = await post(
          header(purchase.id, {
            items: [{ supplier_sku: "NOPE-9", quantity: 1, unit_cost: 1 }],
          })
        )

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("NOPE-9")
        expect(await countInvoices()).toBe(0)
      })

      it("remembers a new code for a picked variant and creates the invoice", async () => {
        const { supplier, purchase } = await setup()
        const other = await createVariant("Red Small")

        const response = await post(
          header(purchase.id, {
            items: [
              {
                variant_id: other.id,
                supplier_sku: " RS-1 ",
                remember_code: true,
                quantity: 2,
                unit_cost: 3,
              },
            ],
          })
        )

        expect(response.status).toBe(200)
        expect(response.data.invoice.items[0]).toMatchObject({
          variant_id: other.id,
          supplier_sku: "RS-1",
          purchase_item_id: null,
        })
        const listed = await listSupplierProducts(supplier.id)
        expect(listed).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ variant_id: other.id, supplier_sku: "RS-1" }),
          ])
        )
        expect(listed).toHaveLength(2)
      })

      it("remember-code of a code already on the list returns the existing message and creates nothing", async () => {
        const { supplier, purchase } = await setup()
        const other = await createVariant("Red Small")
        const fresh = await createVariant("Green")

        // The first line's new code is added, then removed again when the
        // second line's code turns out to be taken.
        const response = await post(
          header(purchase.id, {
            items: [
              {
                variant_id: fresh.id,
                supplier_sku: "GR-1",
                remember_code: true,
                quantity: 1,
                unit_cost: 1,
              },
              {
                variant_id: other.id,
                supplier_sku: "ac-100",
                remember_code: true,
                quantity: 1,
                unit_cost: 1,
              },
            ],
          })
        )

        expect(response.status).toBe(400)
        expect(response.data.message).toMatch(/code .* already used/i)
        expect(await countInvoices()).toBe(0)
        expect(await listSupplierProducts(supplier.id)).toHaveLength(1)
      })

      it("rolls back remembered codes when creating the invoice fails", async () => {
        const { supplier, purchase } = await setup()
        const other = await createVariant("Red Small")
        const third = await createVariant("Green")

        const spy = jest
          .spyOn(accounting(), "createInvoices")
          .mockRejectedValueOnce(new Error("invoice create failed"))
        let response: any
        try {
          response = await post(
            header(purchase.id, {
              items: [
                {
                  variant_id: other.id,
                  supplier_sku: "RS-1",
                  remember_code: true,
                  quantity: 1,
                  unit_cost: 1,
                },
                {
                  variant_id: third.id,
                  supplier_sku: "GR-1",
                  remember_code: true,
                  quantity: 1,
                  unit_cost: 1,
                },
              ],
            })
          )
        } finally {
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        expect(await countInvoices()).toBe(0)
        const listed = await listSupplierProducts(supplier.id)
        expect(listed.map((p) => p.supplier_sku)).toEqual(["AC-100"])
      })

      it("saves a variant that is not on the purchase with purchase_item_id null", async () => {
        const { purchase } = await setup()
        const other = await createVariant("Not ordered")

        const response = await post(
          header(purchase.id, {
            items: [{ variant_id: other.id, quantity: 1, unit_cost: 4 }],
          })
        )

        expect(response.status).toBe(200)
        expect(response.data.invoice.items[0]).toMatchObject({
          variant_id: other.id,
          purchase_item_id: null,
          supplier_sku: "",
          description: "Not ordered",
        })
      })

      it("requires purchase_item_id when the variant is on the purchase twice", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant()
        const purchase = await orderedPurchase(supplier.id, [
          { variant_id: variant.id, quantity: 1, unit_cost: 2 },
          { variant_id: variant.id, quantity: 2, unit_cost: 3 },
        ])

        const ambiguous = await post(
          header(purchase.id, {
            items: [{ variant_id: variant.id, quantity: 1, unit_cost: 2 }],
          })
        )
        expect(ambiguous.status).toBe(400)
        expect(ambiguous.data.message).toContain("purchase_item_id")

        const named = await post(
          header(purchase.id, {
            items: [
              {
                variant_id: variant.id,
                purchase_item_id: purchase.items[1].id,
                quantity: 2,
                unit_cost: 3,
              },
            ],
          })
        )
        expect(named.status).toBe(200)
        expect(named.data.invoice.items[0].purchase_item_id).toBe(
          purchase.items[1].id
        )
      })

      it("rejects a purchase_item_id from another purchase with 400", async () => {
        const { supplier, variant, purchase } = await setup()
        const otherPurchase = await orderedPurchase(supplier.id, [
          { variant_id: variant.id, quantity: 1, unit_cost: 2 },
        ])

        const response = await post(
          header(purchase.id, {
            items: [
              {
                variant_id: variant.id,
                purchase_item_id: otherPurchase.items[0].id,
                quantity: 1,
                unit_cost: 2,
              },
            ],
          })
        )

        expect(response.status).toBe(400)
        expect(await countInvoices()).toBe(0)
      })

      it("returns 404 for an unknown purchase", async () => {
        const variant = await createVariant()
        const response = await post(
          header("pur_missing", {
            items: [{ variant_id: variant.id, quantity: 1, unit_cost: 1 }],
          })
        )
        expect(response.status).toBe(404)
      })

      it("returns 401 without authentication", async () => {
        const response = await api
          .post("/admin/invoices", {})
          .catch((e) => e.response)
        expect(response.status).toBe(401)
      })

      it.each([
        ["blank invoice number", { invoice_number: "   " }],
        ["zero quantity", { items: [{ supplier_sku: "AC-100", quantity: 0, unit_cost: 1 }] }],
        ["negative unit cost", { items: [{ supplier_sku: "AC-100", quantity: 1, unit_cost: -1 }] }],
        ["negative shipping", { shipping_cost: -1 }],
        ["bad invoice date", { invoice_date: "2026-13-45" }],
        ["bad due date", { due_date: "tomorrow" }],
        ["no items", { items: [] }],
        ["line with neither code nor variant", { items: [{ quantity: 1, unit_cost: 1 }] }],
        ["remember_code without a variant", { items: [{ supplier_sku: "X", remember_code: true, quantity: 1, unit_cost: 1 }] }],
      ])("rejects %s with 400", async (_name, over) => {
        const { purchase } = await setup()
        const response = await post(
          header(purchase.id, {
            items: [{ supplier_sku: "AC-100", quantity: 1, unit_cost: 1 }],
            ...over,
          })
        )
        expect(response.status).toBe(400)
        expect(await countInvoices()).toBe(0)
      })

      describe("duplicate supplier invoice number", () => {
        const line = [{ supplier_sku: "AC-100", quantity: 1, unit_cost: 1 }]

        it("rejects the same number for the same supplier (any case or spacing), naming supplier and number", async () => {
          const { purchase } = await setup()
          const first = await post(
            header(purchase.id, { invoice_number: "Inv-77", items: line })
          )
          expect(first.status).toBe(200)

          const second = await post(
            header(purchase.id, { invoice_number: "  inv-77 ", items: line })
          )
          expect(second.status).toBe(400)
          expect(second.data.message).toContain("Acme")
          expect(second.data.message).toContain("inv-77")
          expect(await countInvoices()).toBe(1)
        })

        it("allows the same number for a different supplier", async () => {
          const a = await setup("Acme")
          const b = await setup("Beta")
          expect(
            (await post(header(a.purchase.id, { invoice_number: "X-1", items: line }))).status
          ).toBe(200)
          expect(
            (await post(header(b.purchase.id, { invoice_number: "X-1", items: line }))).status
          ).toBe(200)
        })

        it("allows the number again after the first invoice is voided", async () => {
          const { purchase } = await setup()
          const first = await post(
            header(purchase.id, { invoice_number: "V-1", items: line })
          )
          await accounting().updateInvoices({
            id: first.data.invoice.id,
            status: "void",
          })

          const again = await post(
            header(purchase.id, { invoice_number: "V-1", items: line })
          )
          expect(again.status).toBe(200)
        })

        it("maps a database unique violation to the same message when the pre-check misses", async () => {
          const { purchase } = await setup()
          const first = await post(
            header(purchase.id, { invoice_number: "DB-1", items: line })
          )
          expect(first.status).toBe(200)

          // Hide the existing invoice from the pre-check only, so the insert
          // reaches the partial unique index.
          const spy = jest
            .spyOn(accounting(), "listInvoices")
            .mockResolvedValueOnce([])
          let second: any
          try {
            second = await post(
              header(purchase.id, { invoice_number: "db-1", items: line })
            )
          } finally {
            spy.mockRestore()
          }

          expect(second.status).toBe(400)
          expect(second.data.message).toBe(
            'Invoice number "db-1" already exists for supplier Acme'
          )
          expect(await countInvoices()).toBe(1)
        })

        it("a concurrent pair yields exactly one 200 and one 400", async () => {
          const { purchase } = await setup()

          const responses = await Promise.all([
            post(header(purchase.id, { invoice_number: "RACE", items: line })),
            post(header(purchase.id, { invoice_number: "race", items: line })),
          ])

          expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
          const failed = responses.find((r) => r.status === 400)!
          expect(failed.data.message).toContain("Acme")
          expect(await countInvoices()).toBe(1)
        })
      })

      it("leaves stock levels unchanged", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant("Stocked", true)
        const location = (
          await api.post(
            "/admin/stock-locations",
            { name: "Main" },
            adminHeaders
          )
        ).data.stock_location
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "product_variant",
          fields: ["id", "inventory_items.inventory_item_id"],
          filters: { id: variant.id },
        })
        const inventoryItemId = (data[0] as any).inventory_items[0]
          .inventory_item_id as string
        await api.post(
          `/admin/inventory-items/${inventoryItemId}/location-levels`,
          { location_id: location.id, stocked_quantity: 7 },
          adminHeaders
        )
        const levels = async () => {
          const inventory = getContainer().resolve(Modules.INVENTORY) as any
          const rows = await inventory.listInventoryLevels({
            inventory_item_id: inventoryItemId,
          })
          return rows.map((r: any) => ({
            location_id: r.location_id,
            stocked_quantity: Number(r.stocked_quantity),
            reserved_quantity: Number(r.reserved_quantity),
            incoming_quantity: Number(r.incoming_quantity),
          }))
        }
        const purchase = await orderedPurchase(supplier.id, [
          { variant_id: variant.id, quantity: 5, unit_cost: 2 },
        ])
        const before = await levels()

        const response = await post(
          header(purchase.id, {
            items: [{ variant_id: variant.id, quantity: 5, unit_cost: 2 }],
          })
        )

        expect(response.status).toBe(200)
        expect(await levels()).toEqual(before)
        expect(before[0].stocked_quantity).toBe(7)
      })
    })

    describe("GET /admin/invoices", () => {
      const lineFor = (n = 1) => [
        { supplier_sku: "AC-100", quantity: n, unit_cost: 2 },
      ]
      const create = async (
        purchaseId: string,
        invoiceNumber: string,
        n = 1
      ) => {
        // A small gap keeps created_at distinct so the newest-first order
        // never depends on the id tiebreak.
        await new Promise((resolve) => setTimeout(resolve, 20))
        return (
          await post(
            header(purchaseId, {
              invoice_number: invoiceNumber,
              items: lineFor(n),
            })
          )
        ).data.invoice as { id: string }
      }
      const list =(qs = "") =>
        api.get(`/admin/invoices${qs}`, adminHeaders).catch((e) => e.response)

      it("lists newest first with items, supplier and purchase, and counts", async () => {
        const { supplier, purchase } = await setup()
        const a = await create(purchase.id, "N-1")
        const b = await create(purchase.id, "N-2")

        const response = await list()

        expect(response.status).toBe(200)
        expect(response.data.count).toBe(2)
        expect(response.data.offset).toBe(0)
        expect(response.data.limit).toBe(20)
        expect(response.data.invoices.map((i: any) => i.id)).toEqual([b.id, a.id])
        expect(response.data.invoices[0]).toMatchObject({
          supplier: { id: supplier.id, name: "Acme" },
          purchase: { id: purchase.id, reference: purchase.reference },
          items: [expect.objectContaining({ quantity: 1 })],
          total: 2,
        })
      })

      it("filters by purchase_id, supplier_id and status", async () => {
        const a = await setup("Acme")
        const b = await setup("Beta")
        const ia = await create(a.purchase.id, "F-1")
        const ib = await create(b.purchase.id, "F-1")
        await accounting().updateInvoices({ id: ib.id, status: "posted" })

        const ids = async (qs: string) =>
          (await list(qs)).data.invoices.map((i: any) => i.id)
        expect(await ids(`?purchase_id=${a.purchase.id}`)).toEqual([ia.id])
        expect(await ids(`?supplier_id=${b.supplier.id}`)).toEqual([ib.id])
        expect(await ids("?status=posted")).toEqual([ib.id])
        expect(await ids("?status=draft")).toEqual([ia.id])
        expect((await list("?status=bogus")).status).toBe(400)
      })

      it("finds by invoice number case-insensitively, matching % and _ literally", async () => {
        const { purchase } = await setup()
        const plain = await create(purchase.id, "ABC-100")
        const pct = await create(purchase.id, "50%-OFF")
        const under = await create(purchase.id, "A_B")
        await create(purchase.id, "AXB")

        const ids = async (q: string) =>
          (await list(`?q=${encodeURIComponent(q)}`)).data.invoices
            .map((i: any) => i.id)
            .sort()
        expect(await ids("abc-1")).toEqual([plain.id])
        expect(await ids("%")).toEqual([pct.id])
        expect(await ids("a_b")).toEqual([under.id])
        expect(await ids("  ABC  ")).toEqual([plain.id])
      })

      it("ignores a whitespace-only q", async () => {
        const { purchase } = await setup()
        await create(purchase.id, "W-1")
        const response = await list("?q=%20%20")
        expect(response.data.count).toBe(1)
      })

      it("paginates and validates limit and offset", async () => {
        const { purchase } = await setup()
        const ids: string[] = []
        for (const n of ["P-1", "P-2", "P-3"]) {
          ids.push((await create(purchase.id, n)).id)
        }

        const page = await list("?limit=2&offset=1")
        expect(page.data.count).toBe(3)
        expect(page.data.limit).toBe(2)
        expect(page.data.offset).toBe(1)
        expect(page.data.invoices.map((i: any) => i.id)).toEqual([
          ids[1],
          ids[0],
        ])

        for (const qs of ["?limit=0", "?limit=101", "?limit=x", "?offset=-1"]) {
          expect((await list(qs)).status).toBe(400)
        }
      })
    })

    describe("GET /admin/invoices/:id", () => {
      it("returns the comparison across two posted invoices", async () => {
        const { variant, purchase } = await setup()
        const make = async (num: string, qty: number, cost: number) =>
          (
            await post(
              header(purchase.id, {
                invoice_number: num,
                items: [{ variant_id: variant.id, quantity: qty, unit_cost: cost }],
              })
            )
          ).data.invoice as { id: string }
        const first = await make("C-1", 6, 2)
        const second = await make("C-2", 7, 2.5)
        const draft = await make("C-3", 50, 2)
        const voided = await make("C-4", 50, 2)
        await accounting().updateInvoices({ id: first.id, status: "posted" })
        await accounting().updateInvoices({ id: second.id, status: "posted" })
        await accounting().updateInvoices({ id: voided.id, status: "void" })
        expect(draft.id).toBeDefined()

        const response = await api.get(`/admin/invoices/${second.id}`, adminHeaders)

        expect(response.status).toBe(200)
        expect(response.data.invoice.id).toBe(second.id)
        expect(response.data.comparison).toEqual({
          items: [
            {
              purchase_item_id: purchase.items[0].id,
              variant_id: variant.id,
              title: purchase.items[0].title,
              ordered_quantity: 10,
              received_quantity: 0,
              invoiced_quantity: 7,
              invoiced_quantity_total: 13,
              ordered_unit_cost: 2,
              invoiced_unit_cost: 2.5,
              flags: {
                price_difference: true,
                over_received: true,
                over_ordered: true,
                not_on_purchase: false,
              },
            },
          ],
          purchase_total: 20,
          invoice_total: 17.5,
          difference: -2.5,
        })
      })

      it("counts every posted sibling invoice (no default page cap)", async () => {
        const { supplier, variant, purchase } = await setup()
        const mine = (
          await post(
            header(purchase.id, {
              invoice_number: "BIG-0",
              items: [{ variant_id: variant.id, quantity: 1, unit_cost: 2 }],
            })
          )
        ).data.invoice as { id: string }
        const siblings = Array.from({ length: 60 }, (_, i) => ({
          supplier_id: supplier.id,
          purchase_id: purchase.id,
          invoice_number: `SIB-${i}`,
          invoice_number_key: `sib-${i}`,
          status: "posted",
          invoice_date: new Date("2026-11-01"),
          items: [
            {
              purchase_item_id: purchase.items[0].id,
              variant_id: variant.id,
              supplier_sku: "AC-100",
              description: "x",
              quantity: 1,
              unit_cost: 2,
            },
          ],
        }))
        await accounting().createInvoices(siblings)

        const response = await api.get(`/admin/invoices/${mine.id}`, adminHeaders)

        expect(response.status).toBe(200)
        expect(response.data.comparison.items[0].invoiced_quantity_total).toBe(61)
      })

      it("still returns 200 when the variant left the catalog", async () => {
        const { variant, purchase } = await setup()
        const invoice = (
          await post(
            header(purchase.id, {
              items: [{ variant_id: variant.id, quantity: 2, unit_cost: 2 }],
            })
          )
        ).data.invoice
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "product_variant",
          fields: ["id", "product_id"],
          filters: { id: variant.id },
        })
        await api.delete(
          `/admin/products/${(data[0] as any).product_id}`,
          adminHeaders
        )

        const response = await api
          .get(`/admin/invoices/${invoice.id}`, adminHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(200)
        expect(response.data.invoice.items).toHaveLength(1)
        expect(response.data.comparison.items[0]).toMatchObject({
          purchase_item_id: purchase.items[0].id,
          title: purchase.items[0].title,
          invoiced_quantity: 2,
        })
      })

      it("returns 404 for an unknown id", async () => {
        const response = await api
          .get("/admin/invoices/inv_missing", adminHeaders)
          .catch((e) => e.response)
        expect(response.status).toBe(404)
      })
    })
  },
})
