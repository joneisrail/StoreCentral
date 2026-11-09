import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ACCOUNTING_MODULE } from "../../src/modules/accounting"
import { invoiceStatusLockKey } from "../../src/modules/accounting/utils"
import { createAdminUser } from "../helpers/create-admin-user"

// Entry point of src/links/invoice-item-variant.ts (importing the link file
// here would define it before Medusa is loaded).
const INVOICE_ITEM_VARIANT_LINK = "invoice_item_product_variant"

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

    const header = (
      purchaseId: string,
      over: Record<string, unknown> = {}
    ) => ({
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
            expect.objectContaining({
              variant_id: other.id,
              supplier_sku: "RS-1",
            }),
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
        [
          "zero quantity",
          { items: [{ supplier_sku: "AC-100", quantity: 0, unit_cost: 1 }] },
        ],
        [
          "negative unit cost",
          { items: [{ supplier_sku: "AC-100", quantity: 1, unit_cost: -1 }] },
        ],
        ["negative shipping", { shipping_cost: -1 }],
        ["bad invoice date", { invoice_date: "2026-13-45" }],
        ["bad due date", { due_date: "tomorrow" }],
        ["no items", { items: [] }],
        [
          "line with neither code nor variant",
          { items: [{ quantity: 1, unit_cost: 1 }] },
        ],
        [
          "remember_code without a variant",
          {
            items: [
              {
                supplier_sku: "X",
                remember_code: true,
                quantity: 1,
                unit_cost: 1,
              },
            ],
          },
        ],
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
            (
              await post(
                header(a.purchase.id, { invoice_number: "X-1", items: line })
              )
            ).status
          ).toBe(200)
          expect(
            (
              await post(
                header(b.purchase.id, { invoice_number: "X-1", items: line })
              )
            ).status
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
      const list = (qs = "") =>
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
        expect(response.data.invoices.map((i: any) => i.id)).toEqual([
          b.id,
          a.id,
        ])
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
                items: [
                  { variant_id: variant.id, quantity: qty, unit_cost: cost },
                ],
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

        const response = await api.get(
          `/admin/invoices/${second.id}`,
          adminHeaders
        )

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

        const response = await api.get(
          `/admin/invoices/${mine.id}`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.comparison.items[0].invoiced_quantity_total).toBe(
          61
        )
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

    describe("POST /admin/invoices/:id", () => {
      const update = (id: string, body: Record<string, unknown>) =>
        api
          .post(`/admin/invoices/${id}`, body, adminHeaders)
          .catch((e) => e.response)

      const detail = async (id: string) =>
        (await api.get(`/admin/invoices/${id}`, adminHeaders)).data.invoice

      // Item-to-variant link rows for the given invoice items.
      const itemLinks = async (itemIds: string[]) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: INVOICE_ITEM_VARIANT_LINK,
          fields: ["invoice_item_id", "product_variant_id"],
          filters: { invoice_item_id: itemIds },
        })
        return (data as any[])
          .map((row) => ({
            invoice_item_id: row.invoice_item_id as string,
            product_variant_id: row.product_variant_id as string,
          }))
          .sort((a, b) => a.invoice_item_id.localeCompare(b.invoice_item_id))
      }

      // A draft invoice with one line resolved from the supplier code.
      const draft = async (supplierName = "Acme") => {
        const ctx = await setup(supplierName)
        const response = await post(
          header(ctx.purchase.id, {
            shipping_cost: 1,
            notes: "original",
            items: [{ supplier_sku: "AC-100", quantity: 4, unit_cost: 2 }],
          })
        )
        expect(response.status).toBe(200)
        return { ...ctx, invoice: response.data.invoice }
      }

      it("edits header fields only and leaves the lines unchanged", async () => {
        const { invoice, variant } = await draft()

        const response = await update(invoice.id, {
          invoice_date: "2026-11-03",
          due_date: "2026-12-03",
          shipping_cost: 3,
          tax: 0.5,
          other_cost: 0.25,
          notes: "edited",
        })

        expect(response.status).toBe(200)
        expect(response.data.invoice).toMatchObject({
          id: invoice.id,
          status: "draft",
          invoice_number: "A-1",
          invoice_date: "2026-11-03",
          due_date: "2026-12-03",
          shipping_cost: 3,
          tax: 0.5,
          other_cost: 0.25,
          notes: "edited",
          subtotal: 8,
          total: 11.75,
        })
        expect(response.data.invoice.items).toEqual(invoice.items)
        expect(await itemLinks([invoice.items[0].id])).toEqual([
          {
            invoice_item_id: invoice.items[0].id,
            product_variant_id: variant.id,
          },
        ])
      })

      it("replaces every line when items are given, and the totals and links follow", async () => {
        const { invoice, purchase, variant } = await draft()
        const other = await createVariant("Off list")

        const response = await update(invoice.id, {
          items: [
            { variant_id: variant.id, quantity: 10, unit_cost: 3 },
            {
              variant_id: other.id,
              quantity: 1,
              unit_cost: 5,
              description: "Extra",
            },
          ],
        })

        expect(response.status).toBe(200)
        const updated = response.data.invoice
        expect(updated).toMatchObject({
          subtotal: 35,
          total: 36,
          notes: "original",
        })
        expect(updated.items).toHaveLength(2)
        expect(updated.items.map((i: any) => i.id)).not.toContain(
          invoice.items[0].id
        )
        expect(updated.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: variant.id,
              purchase_item_id: purchase.items[0].id,
              supplier_sku: "AC-100",
              quantity: 10,
              unit_cost: 3,
            }),
            expect.objectContaining({
              variant_id: other.id,
              purchase_item_id: null,
              description: "Extra",
              quantity: 1,
              unit_cost: 5,
            }),
          ])
        )

        // The replaced line's link is gone; each new line is linked.
        expect(await itemLinks([invoice.items[0].id])).toEqual([])
        expect(await itemLinks(updated.items.map((i: any) => i.id))).toEqual(
          updated.items
            .map((i: any) => ({
              invoice_item_id: i.id,
              product_variant_id: i.variant_id,
            }))
            .sort((a: any, b: any) =>
              a.invoice_item_id.localeCompare(b.invoice_item_id)
            )
        )
        const [, itemCount] = await accounting().listAndCountInvoiceItems({})
        expect(itemCount).toBe(2)
      })

      describe("invoice number", () => {
        it("rejects a number another invoice of the supplier uses, naming supplier and number", async () => {
          const { invoice, purchase } = await draft()
          const other = await post(
            header(purchase.id, {
              invoice_number: "Taken-1",
              items: [{ supplier_sku: "AC-100", quantity: 1, unit_cost: 1 }],
            })
          )
          expect(other.status).toBe(200)

          const response = await update(invoice.id, {
            invoice_number: " taken-1 ",
            notes: "should not stick",
          })

          expect(response.status).toBe(400)
          expect(response.data.message).toBe(
            'Invoice number "taken-1" already exists for supplier Acme'
          )
          expect(await detail(invoice.id)).toMatchObject({
            invoice_number: "A-1",
            notes: "original",
          })
        })

        it("accepts the invoice's own number (any case), a voided number and another supplier's number", async () => {
          const { invoice, purchase } = await draft("Acme")
          const beta = await setup("Beta")
          const line = [{ supplier_sku: "AC-100", quantity: 1, unit_cost: 1 }]
          const voided = await post(
            header(purchase.id, { invoice_number: "OLD-1", items: line })
          )
          await accounting().updateInvoices({
            id: voided.data.invoice.id,
            status: "void",
          })
          expect(
            (
              await post(
                header(beta.purchase.id, { invoice_number: "B-1", items: line })
              )
            ).status
          ).toBe(200)

          const own = await update(invoice.id, { invoice_number: " a-1 " })
          expect(own.status).toBe(200)
          expect(own.data.invoice.invoice_number).toBe("a-1")

          const reused = await update(invoice.id, { invoice_number: "old-1" })
          expect(reused.status).toBe(200)

          const crossSupplier = await update(invoice.id, {
            invoice_number: "B-1",
          })
          expect(crossSupplier.status).toBe(200)
          expect(crossSupplier.data.invoice.invoice_number).toBe("B-1")
        })
      })

      it.each([
        ["purchase_id", { purchase_id: "pur_other" }],
        ["an unknown key", { bogus: true }],
        ["empty items", { items: [] }],
        ["a blank invoice number", { invoice_number: "  " }],
        ["a negative tax", { tax: -1 }],
      ])("rejects %s with 400", async (_name, body) => {
        const { invoice } = await draft()
        const response = await update(invoice.id, body)
        expect(response.status).toBe(400)
        expect(await detail(invoice.id)).toEqual(invoice)
      })

      it.each(["posted", "void"])(
        "refuses to edit a %s invoice with 400 locked and changes nothing",
        async (status) => {
          const { invoice, supplier, variant } = await draft()
          await accounting().updateInvoices({ id: invoice.id, status })
          const before = await detail(invoice.id)

          const response = await update(invoice.id, {
            notes: "nope",
            items: [
              {
                variant_id: variant.id,
                supplier_sku: "NEW-CODE",
                remember_code: true,
                quantity: 1,
                unit_cost: 1,
              },
            ],
          })

          expect(response.status).toBe(400)
          expect(response.data.message).toContain("locked")
          expect(await detail(invoice.id)).toEqual(before)
          expect(await itemLinks([invoice.items[0].id])).toHaveLength(1)
          expect(await listSupplierProducts(supplier.id)).toHaveLength(1)
        }
      )

      it("restores the old lines, header and links when replacing the lines fails", async () => {
        const { invoice, variant } = await draft()
        const other = await createVariant("Other")
        const before = await detail(invoice.id)

        // The first delete is the one removing the replaced lines, after the
        // new lines and the header were written.
        const spy = jest
          .spyOn(accounting(), "deleteInvoiceItems")
          .mockRejectedValueOnce(new Error("delete failed"))
        let response: any
        let calls = 0
        try {
          response = await update(invoice.id, {
            invoice_number: "CHANGED",
            notes: "changed",
            shipping_cost: 9,
            items: [{ variant_id: other.id, quantity: 1, unit_cost: 1 }],
          })
        } finally {
          calls = spy.mock.calls.length
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        expect(calls).toBeGreaterThan(0)
        expect(await detail(invoice.id)).toEqual(before)
        const [, itemCount] = await accounting().listAndCountInvoiceItems({})
        expect(itemCount).toBe(1)
        expect(await itemLinks([invoice.items[0].id])).toEqual([
          {
            invoice_item_id: invoice.items[0].id,
            product_variant_id: variant.id,
          },
        ])
      })

      it("restores the old lines (same ids), header and links when linking the new lines fails", async () => {
        const { invoice, variant } = await draft()
        const other = await createVariant("Other")
        const before = await detail(invoice.id)
        const link = getContainer().resolve(
          ContainerRegistrationKeys.LINK
        ) as any

        const spy = jest
          .spyOn(link, "create")
          .mockRejectedValueOnce(new Error("link failed"))
        let response: any
        let calls = 0
        try {
          response = await update(invoice.id, {
            notes: "changed",
            items: [{ variant_id: other.id, quantity: 1, unit_cost: 1 }],
          })
        } finally {
          calls = spy.mock.calls.length
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        expect(calls).toBeGreaterThan(0)
        expect(await detail(invoice.id)).toEqual(before)
        const items = await accounting().listInvoiceItems({})
        expect(items.map((i: any) => i.id)).toEqual([invoice.items[0].id])
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: INVOICE_ITEM_VARIANT_LINK,
          fields: ["invoice_item_id", "product_variant_id"],
        })
        expect(
          (data as any[]).map((row) => ({
            invoice_item_id: row.invoice_item_id,
            product_variant_id: row.product_variant_id,
          }))
        ).toEqual([
          {
            invoice_item_id: invoice.items[0].id,
            product_variant_id: variant.id,
          },
        ])
      })

      it("restores the old lines and links when dismissing the old links fails", async () => {
        const { invoice, variant } = await draft()
        const other = await createVariant("Other")
        const before = await detail(invoice.id)
        const link = getContainer().resolve(
          ContainerRegistrationKeys.LINK
        ) as any

        const spy = jest
          .spyOn(link, "dismiss")
          .mockRejectedValueOnce(new Error("dismiss failed"))
        let response: any
        try {
          response = await update(invoice.id, {
            notes: "changed",
            items: [{ variant_id: other.id, quantity: 1, unit_cost: 1 }],
          })
        } finally {
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        expect(await detail(invoice.id)).toEqual(before)
        expect(await itemLinks([invoice.items[0].id])).toEqual([
          {
            invoice_item_id: invoice.items[0].id,
            product_variant_id: variant.id,
          },
        ])
        const all = await accounting().listInvoiceItems({})
        expect(all.map((i: any) => i.id)).toEqual([invoice.items[0].id])
      })

      it("never overwrites a post that lands while the update waits for the lock", async () => {
        const { invoice, variant } = await draft()
        const other = await createVariant("Other")
        const locking = getContainer().resolve(Modules.LOCKING)

        let release!: () => void
        const held = new Promise<void>((resolve) => (release = resolve))
        let acquired!: () => void
        const gotLock = new Promise<void>((resolve) => (acquired = resolve))
        const holder = locking.execute(
          [invoiceStatusLockKey(invoice.id)],
          async () => {
            acquired()
            await held
          }
        )
        await gotLock

        const pending = update(invoice.id, {
          invoice_number: "RACE-1",
          notes: "changed",
          items: [{ variant_id: other.id, quantity: 1, unit_cost: 1 }],
        })
        // The update passed its unlocked draft check and is now waiting.
        await new Promise((resolve) => setTimeout(resolve, 700))
        await accounting().updateInvoices({ id: invoice.id, status: "posted" })
        const posted = await detail(invoice.id)
        release()
        await holder

        const response = await pending
        expect(response.status).toBe(400)
        expect(response.data.message).toContain("locked")
        expect(await detail(invoice.id)).toEqual(posted)
        expect(await itemLinks([invoice.items[0].id])).toEqual([
          {
            invoice_item_id: invoice.items[0].id,
            product_variant_id: variant.id,
          },
        ])
        const [, itemCount] = await accounting().listAndCountInvoiceItems({})
        expect(itemCount).toBe(1)
      })

      it("keeps exactly one link per line across repeated updates", async () => {
        const { invoice, variant } = await draft()
        const other = await createVariant("Other")

        let current = invoice
        for (let i = 0; i < 3; i++) {
          const response = await update(current.id, {
            items: [
              { variant_id: variant.id, quantity: i + 1, unit_cost: 1 },
              { variant_id: other.id, quantity: 1, unit_cost: 1 },
            ],
          })
          expect(response.status).toBe(200)
          current = response.data.invoice
          expect(current.items).toHaveLength(2)
        }

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: INVOICE_ITEM_VARIANT_LINK,
          fields: ["invoice_item_id", "product_variant_id"],
        })
        const rows = data as any[]
        expect(rows.map((r) => r.invoice_item_id).sort()).toEqual(
          current.items.map((i: any) => i.id).sort()
        )
        for (const item of current.items) {
          expect(
            rows.filter((r) => r.invoice_item_id === item.id)
          ).toHaveLength(1)
        }
      })

      it("remembers a code on update", async () => {
        const { invoice, supplier } = await draft()
        const other = await createVariant("Red Small")

        const response = await update(invoice.id, {
          items: [
            {
              variant_id: other.id,
              supplier_sku: "RS-9",
              remember_code: true,
              quantity: 2,
              unit_cost: 3,
            },
          ],
        })

        expect(response.status).toBe(200)
        expect(response.data.invoice.items[0]).toMatchObject({
          variant_id: other.id,
          supplier_sku: "RS-9",
        })
        expect(
          (await listSupplierProducts(supplier.id))
            .map((p) => p.supplier_sku)
            .sort()
        ).toEqual(["AC-100", "RS-9"])
      })

      it("rolls a remembered code back with a failed update", async () => {
        const { invoice, supplier } = await draft()
        const other = await createVariant("Red Small")
        const before = await detail(invoice.id)

        const spy = jest
          .spyOn(accounting(), "createInvoiceItems")
          .mockRejectedValueOnce(new Error("item create failed"))
        let response: any
        let calls = 0
        try {
          response = await update(invoice.id, {
            notes: "changed",
            items: [
              {
                variant_id: other.id,
                supplier_sku: "RS-9",
                remember_code: true,
                quantity: 2,
                unit_cost: 3,
              },
            ],
          })
        } finally {
          calls = spy.mock.calls.length
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        expect(calls).toBeGreaterThan(0)
        expect(await detail(invoice.id)).toEqual(before)
        expect(
          (await listSupplierProducts(supplier.id)).map((p) => p.supplier_sku)
        ).toEqual(["AC-100"])
      })

      it("rejects a code listed for a different variant with 400", async () => {
        const { invoice, supplier } = await draft()
        const other = await createVariant("Red Small")
        await addSupplierProduct(supplier.id, {
          variant_id: other.id,
          supplier_sku: "RS-1",
        })
        const third = await createVariant("Green")

        const response = await update(invoice.id, {
          items: [
            {
              variant_id: third.id,
              supplier_sku: "rs-1",
              quantity: 1,
              unit_cost: 1,
            },
          ],
        })

        expect(response.status).toBe(400)
        expect(response.data.message).toContain(
          "listed for a different product"
        )
        expect(await detail(invoice.id)).toEqual(invoice)
      })

      it("rejects a purchase_item_id whose variant differs from the line's with 400", async () => {
        const { invoice, purchase } = await draft()
        const other = await createVariant("Red Small")

        const response = await update(invoice.id, {
          items: [
            {
              variant_id: other.id,
              purchase_item_id: purchase.items[0].id,
              quantity: 1,
              unit_cost: 1,
            },
          ],
        })

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("different product")
        expect(await detail(invoice.id)).toEqual(invoice)
      })

      it("returns 404 for an unknown id", async () => {
        const response = await update("inv_missing", { notes: "x" })
        expect(response.status).toBe(404)
      })
    })

    describe("POST /admin/invoices/:id/post and /void", () => {
      const act = (id: string, action: "post" | "void") =>
        api
          .post(`/admin/invoices/${id}/${action}`, {}, adminHeaders)
          .catch((e) => e.response)

      const detail = async (id: string) =>
        (await api.get(`/admin/invoices/${id}`, adminHeaders)).data.invoice

      const lineFor = (variantId: string, quantity = 4) => [
        { variant_id: variantId, quantity, unit_cost: 2 },
      ]

      const draft = async (
        number = "P-1",
        ctx?: Awaited<ReturnType<typeof setup>>
      ) => {
        const c = ctx ?? (await setup())
        const response = await post(
          header(c.purchase.id, {
            invoice_number: number,
            items: lineFor(c.variant.id),
          })
        )
        expect(response.status).toBe(200)
        return { ...c, invoice: response.data.invoice }
      }

      it("posts a draft invoice and sets status and posted_at", async () => {
        const { invoice } = await draft()
        const before = Date.now()

        const response = await act(invoice.id, "post")

        expect(response.status).toBe(200)
        expect(response.data.invoice.id).toBe(invoice.id)
        expect(response.data.invoice.status).toBe("posted")
        expect(response.data.invoice.voided_at).toBeNull()
        expect(
          new Date(response.data.invoice.posted_at).getTime()
        ).toBeGreaterThanOrEqual(before - 1000)
        expect((await detail(invoice.id)).status).toBe("posted")
      })

      it("rejects posting an invoice with no lines", async () => {
        const { invoice } = await draft()
        await accounting().deleteInvoiceItems(
          invoice.items.map((item: any) => item.id)
        )

        const response = await act(invoice.id, "post")

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("no lines")
        expect((await detail(invoice.id)).status).toBe("draft")
      })

      const cancel = (purchaseId: string) =>
        api
          .post(`/admin/purchases/${purchaseId}/cancel`, {}, adminHeaders)
          .catch((e) => e.response)

      it("rejects posting against a cancelled purchase", async () => {
        const ctx = await setup()
        expect((await cancel(ctx.purchase.id)).status).toBe(200)
        const made = await post(
          header(ctx.purchase.id, { items: lineFor(ctx.variant.id) })
        )
        expect(made.status).toBe(200)

        const response = await act(made.data.invoice.id, "post")

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("purchase is cancelled")
        const after = await detail(made.data.invoice.id)
        expect(after.status).toBe("draft")
        expect(after.posted_at).toBeNull()
      })

      it("refuses cancelling a purchase with a draft invoice and names it", async () => {
        const { invoice, purchase } = await draft("A-1")

        const { reference } = await detail(invoice.id)

        const response = await cancel(purchase.id)

        expect(response.status).toBe(400)
        expect(response.data.message).toContain(reference)
        expect(response.data.message).toContain("A-1")
        expect(response.data.message).toContain("draft")
        const after = (
          await api.get(`/admin/purchases/${purchase.id}`, adminHeaders)
        ).data.purchase
        expect(after.status).toBe("ordered")
      })

      it("refuses cancelling a purchase with a posted invoice", async () => {
        const { invoice, purchase } = await draft("A-2")
        expect((await act(invoice.id, "post")).status).toBe(200)

        const response = await cancel(purchase.id)

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("A-2")
        expect(response.data.message).toContain("posted")
      })

      it("allows cancelling once every invoice is void, or when none exist", async () => {
        const { invoice, purchase } = await draft("A-3")
        expect((await act(invoice.id, "void")).status).toBe(200)
        expect((await cancel(purchase.id)).status).toBe(200)

        const other = await setup("Other")
        expect((await cancel(other.purchase.id)).status).toBe(200)
      })

      it("posting works under the nested purchase lock, and two invoices of one purchase post concurrently without deadlock", async () => {
        for (let round = 0; round < 3; round += 1) {
          const ctx = await setup(`Concurrent ${round}`)
          const a = await post(
            header(ctx.purchase.id, {
              invoice_number: "C-1",
              items: lineFor(ctx.variant.id, 2),
            })
          )
          const b = await post(
            header(ctx.purchase.id, {
              invoice_number: "C-2",
              items: lineFor(ctx.variant.id, 2),
            })
          )
          expect(a.status).toBe(200)
          expect(b.status).toBe(200)

          const results = await Promise.all([
            act(a.data.invoice.id, "post"),
            act(b.data.invoice.id, "post"),
          ])

          expect(results.map((r) => r.status)).toEqual([200, 200])
          expect((await detail(a.data.invoice.id)).status).toBe("posted")
          expect((await detail(b.data.invoice.id)).status).toBe("posted")
        }
      })

      it("rejects posting against a draft purchase", async () => {
        const supplier = await createSupplier("Acme")
        const variant = await createVariant("Blue")
        const created = (
          await api.post(
            "/admin/purchases",
            {
              supplier_id: supplier.id,
              items: [{ variant_id: variant.id, quantity: 10, unit_cost: 2 }],
            },
            adminHeaders
          )
        ).data.purchase
        const made = await post(
          header(created.id, { items: lineFor(variant.id) })
        )
        expect(made.status).toBe(200)

        const response = await act(made.data.invoice.id, "post")

        expect(response.status).toBe(400)
        expect(response.data.message).toContain("purchase is draft")
        expect((await detail(made.data.invoice.id)).status).toBe("draft")
      })

      it("rejects posting twice and leaves posted_at unchanged", async () => {
        const { invoice } = await draft()
        const first = await act(invoice.id, "post")
        expect(first.status).toBe(200)

        const second = await act(invoice.id, "post")

        expect(second.status).toBe(400)
        const after = await detail(invoice.id)
        expect(after.status).toBe("posted")
        expect(after.posted_at).toBe(first.data.invoice.posted_at)
      })

      it("refuses edits after posting", async () => {
        const { invoice } = await draft()
        await act(invoice.id, "post")

        const response = await api
          .post(
            `/admin/invoices/${invoice.id}`,
            { notes: "late" },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
        expect((await detail(invoice.id)).notes).toBeNull()
      })

      it("voids a draft invoice, sets voided_at and frees the number", async () => {
        const ctx = await draft("V-1")

        const response = await act(ctx.invoice.id, "void")

        expect(response.status).toBe(200)
        expect(response.data.invoice.status).toBe("void")
        expect(response.data.invoice.posted_at).toBeNull()
        expect(response.data.invoice.voided_at).toEqual(expect.any(String))
        const again = await post(
          header(ctx.purchase.id, {
            invoice_number: "V-1",
            items: lineFor(ctx.variant.id),
          })
        )
        expect(again.status).toBe(200)
      })

      it("voids a posted invoice and keeps posted_at as history", async () => {
        const { invoice } = await draft("V-2")
        const posted = await act(invoice.id, "post")

        const response = await act(invoice.id, "void")

        expect(response.status).toBe(200)
        expect(response.data.invoice.status).toBe("void")
        expect(response.data.invoice.posted_at).toBe(
          posted.data.invoice.posted_at
        )
        expect(response.data.invoice.voided_at).toEqual(expect.any(String))
      })

      it("rejects voiding a void invoice and leaves voided_at unchanged", async () => {
        const { invoice } = await draft()
        const first = await act(invoice.id, "void")

        const second = await act(invoice.id, "void")

        expect(second.status).toBe(400)
        expect((await detail(invoice.id)).voided_at).toBe(
          first.data.invoice.voided_at
        )
      })

      it("rejects posting a void invoice", async () => {
        const { invoice } = await draft()
        await act(invoice.id, "void")

        const response = await act(invoice.id, "post")

        expect(response.status).toBe(400)
        const after = await detail(invoice.id)
        expect(after.status).toBe("void")
        expect(after.posted_at).toBeNull()
      })

      it("returns 404 for an unknown id", async () => {
        expect((await act("inv_missing", "post")).status).toBe(404)
        expect((await act("inv_missing", "void")).status).toBe(404)
      })

      // Void is allowed from draft and posted, so a post racing a void either
      // loses (400, void went first) or runs first and is then voided (200).
      // Either way the invoice ends void and posted_at is set only when the
      // post request reported success.
      it("a concurrent post and void end void and stay consistent", async () => {
        for (let i = 0; i < 3; i++) {
          const { invoice } = await draft(`R-${i}`)

          const [posted, voided] = await Promise.all([
            act(invoice.id, "post"),
            act(invoice.id, "void"),
          ])

          expect(voided.status).toBe(200)
          expect([200, 400]).toContain(posted.status)
          const after = await detail(invoice.id)
          expect(after.status).toBe("void")
          expect(after.voided_at).toEqual(expect.any(String))
          if (posted.status === 200) {
            expect(after.posted_at).toEqual(expect.any(String))
          } else {
            expect(after.posted_at).toBeNull()
          }
        }
      })

      it("two concurrent posts yield exactly one 200 and one 400", async () => {
        const { invoice } = await draft()

        const responses = await Promise.all([
          act(invoice.id, "post"),
          act(invoice.id, "post"),
        ])

        expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
        expect((await detail(invoice.id)).status).toBe("posted")
      })

      it("two concurrent voids yield exactly one 200 and one 400", async () => {
        const { invoice } = await draft()

        const responses = await Promise.all([
          act(invoice.id, "void"),
          act(invoice.id, "void"),
        ])

        expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
        expect((await detail(invoice.id)).status).toBe("void")
      })

      it("counts a posted invoice toward another invoice's invoiced_quantity_total, a void one not", async () => {
        const ctx = await draft("S-1")
        const other = await post(
          header(ctx.purchase.id, {
            invoice_number: "S-2",
            items: lineFor(ctx.variant.id, 3),
          })
        )
        const otherId = other.data.invoice.id as string
        const total = async () =>
          (await api.get(`/admin/invoices/${otherId}`, adminHeaders)).data
            .comparison.items[0].invoiced_quantity_total

        expect(await total()).toBe(3)
        await act(ctx.invoice.id, "post")
        expect(await total()).toBe(7)
        await act(ctx.invoice.id, "void")
        expect(await total()).toBe(3)
      })

      it("leaves stock levels unchanged by post and void", async () => {
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
            stocked_quantity: Number(r.stocked_quantity),
            reserved_quantity: Number(r.reserved_quantity),
            incoming_quantity: Number(r.incoming_quantity),
          }))
        }
        const purchase = await orderedPurchase(supplier.id, [
          { variant_id: variant.id, quantity: 5, unit_cost: 2 },
        ])
        const made = await post(
          header(purchase.id, { items: lineFor(variant.id, 5) })
        )
        const before = await levels()

        expect((await act(made.data.invoice.id, "post")).status).toBe(200)
        expect(await levels()).toEqual(before)
        expect((await act(made.data.invoice.id, "void")).status).toBe(200)
        expect(await levels()).toEqual(before)
        expect(before[0].stocked_quantity).toBe(7)
      })
    })

    describe("POST /admin/invoices/:id (clearing due_date and notes)", () => {
      const update = (id: string, body: Record<string, unknown>) =>
        api
          .post(`/admin/invoices/${id}`, body, adminHeaders)
          .catch((e) => e.response)
      const detail = async (id: string) =>
        (await api.get(`/admin/invoices/${id}`, adminHeaders)).data.invoice

      const withDates = async () => {
        const ctx = await setup()
        const made = await post(
          header(ctx.purchase.id, {
            due_date: "2026-12-01",
            notes: "keep me",
            items: [{ variant_id: ctx.variant.id, quantity: 2, unit_cost: 2 }],
          })
        )
        expect(made.status).toBe(200)
        return { ...ctx, invoice: made.data.invoice }
      }

      it("stores null for due_date and notes when null is sent", async () => {
        const { invoice } = await withDates()
        expect((await detail(invoice.id)).due_date).toBe("2026-12-01")

        const response = await update(invoice.id, {
          due_date: null,
          notes: null,
        })

        expect(response.status).toBe(200)
        expect(response.data.invoice.due_date).toBeNull()
        expect(response.data.invoice.notes).toBeNull()
        const after = await detail(invoice.id)
        expect(after.due_date).toBeNull()
        expect(after.notes).toBeNull()
      })

      it("restores due_date and notes when an update that clears them fails", async () => {
        const { invoice, variant } = await withDates()
        const before = await detail(invoice.id)
        const spy = jest
          .spyOn(accounting(), "deleteInvoiceItems")
          .mockRejectedValueOnce(new Error("delete failed"))
        let response: any
        try {
          response = await update(invoice.id, {
            due_date: null,
            notes: null,
            items: [{ variant_id: variant.id, quantity: 1, unit_cost: 1 }],
          })
        } finally {
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        const after = await detail(invoice.id)
        expect(after.due_date).toBe("2026-12-01")
        expect(after.notes).toBe("keep me")
        expect(after).toEqual(before)
      })

      it("rejects null for invoice_date and invoice_number", async () => {
        const { invoice } = await withDates()

        expect((await update(invoice.id, { invoice_date: null })).status).toBe(
          400
        )
        expect(
          (await update(invoice.id, { invoice_number: null })).status
        ).toBe(400)
        expect((await detail(invoice.id)).invoice_number).toBe("A-1")
      })
    })
  },
})
