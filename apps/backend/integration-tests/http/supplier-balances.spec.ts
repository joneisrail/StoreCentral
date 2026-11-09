import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SUPPLIER_MODULE } from "../../src/modules/supplier"
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
      (await api.post("/admin/suppliers", { name }, adminHeaders)).data
        .supplier as { id: string; name: string }

    const createVariant = async () => {
      counter += 1
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Product ${counter}`,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title: `Variant ${counter}`,
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
      return product.variants[0] as { id: string }
    }

    type Ctx = {
      supplier: { id: string; name: string }
      variant: { id: string }
      purchase: { id: string }
    }

    const setup = async (name: string): Promise<Ctx> => {
      const supplier = await createSupplier(name)
      const variant = await createVariant()
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
      await api.post(`/admin/purchases/${created.id}/order`, {}, adminHeaders)
      return { supplier, variant, purchase: created }
    }

    const invoiceFor = async (
      ctx: Ctx,
      total: number,
      action: "post" | "draft" | "void" = "post",
      dueDate?: string
    ) => {
      counter += 1
      const made = await api.post(
        "/admin/invoices",
        {
          purchase_id: ctx.purchase.id,
          invoice_number: `B-${counter}`,
          invoice_date: "2026-11-01",
          ...(dueDate ? { due_date: dueDate } : {}),
          items: [{ variant_id: ctx.variant.id, quantity: 1, unit_cost: total }],
        },
        adminHeaders
      )
      const invoice = made.data.invoice as { id: string }
      if (action !== "draft") {
        await api.post(`/admin/invoices/${invoice.id}/post`, {}, adminHeaders)
      }
      if (action === "void") {
        await api.post(`/admin/invoices/${invoice.id}/void`, {}, adminHeaders)
      }
      return invoice
    }

    const pay = async (invoiceId: string, amount: number) =>
      (
        await api.post(
          "/admin/supplier-payments",
          {
            invoice_id: invoiceId,
            amount,
            paid_at: "2026-11-05",
            method: "bank_transfer",
          },
          adminHeaders
        )
      ).data.payment as { id: string }

    const list = (qs = "") =>
      api.get(`/admin/supplier-balances${qs}`, adminHeaders)

    describe("GET /admin/supplier-balances", () => {
      it("returns hand-computed balances per supplier", async () => {
        const acme = await setup("Acme")
        const beta = await setup("Beta")
        const draftOnly = await setup("Gamma")

        const a1 = await invoiceFor(acme, 100, "post", "2020-01-01")
        const a2 = await invoiceFor(acme, 50)
        const a3 = await invoiceFor(acme, 25.5, "post", "2099-01-01")
        await invoiceFor(acme, 999, "draft")
        await invoiceFor(acme, 888, "void")
        await invoiceFor(beta, 40, "post", "2020-01-02")
        await invoiceFor(draftOnly, 77, "draft")

        await pay(a1.id, 30)
        await pay(a2.id, 50)
        const voided = await pay(a3.id, 5)
        await api.post(
          `/admin/supplier-payments/${voided.id}/void`,
          {},
          adminHeaders
        )

        const response = await list()
        expect(response.status).toBe(200)
        expect(response.data).toEqual({
          balances: [
            {
              supplier: { id: acme.supplier.id, name: "Acme" },
              invoiced_total: 175.5,
              paid_total: 80,
              balance_owed: 95.5,
              overdue_total: 70,
              open_invoices: 2,
            },
            {
              supplier: { id: beta.supplier.id, name: "Beta" },
              invoiced_total: 40,
              paid_total: 0,
              balance_owed: 40,
              overdue_total: 40,
              open_invoices: 1,
            },
          ],
          count: 2,
          offset: 0,
          limit: 20,
        })
      })

      it("filters by name literally and paginates the filtered set", async () => {
        const names = ["100% Pure", "100X Pure", "Under_Score", "UnderXScore"]
        for (const [i, name] of names.entries()) {
          await invoiceFor(await setup(name), 10 + i)
        }

        const pct = (await list("?q=100%25")).data
        expect(pct.count).toBe(1)
        expect(pct.balances[0].supplier.name).toBe("100% Pure")

        const under = (await list("?q=UNDER_")).data
        expect(under.count).toBe(1)
        expect(under.balances[0].supplier.name).toBe("Under_Score")

        const blank = (await list("?q=%20%20")).data
        expect(blank.count).toBe(4)

        const page = (await list("?q=pure&limit=1&offset=1")).data
        expect(page.count).toBe(2)
        expect(page.limit).toBe(1)
        expect(page.offset).toBe(1)
        expect(page.balances).toHaveLength(1)
        expect(page.balances[0].supplier.name).toBe("100% Pure")
      })

      it("counts every posted invoice beyond one page of 50", async () => {
        const ctx = await setup("Bulk")
        for (let i = 0; i < 60; i += 1) {
          await invoiceFor(ctx, 1)
        }
        const { balances } = (await list()).data
        expect(balances[0].open_invoices).toBe(60)
        expect(balances[0].invoiced_total).toBe(60)
        expect(balances[0].balance_owed).toBe(60)
      })

      it("rejects invalid pagination", async () => {
        for (const qs of ["?limit=0", "?limit=101", "?offset=-1", "?limit=x"]) {
          const res = await list(qs).catch((e) => e.response)
          expect(res.status).toBe(400)
        }
      })

      it("labels a supplier that cannot be found", async () => {
        const ctx = await setup("Ghost")
        await invoiceFor(ctx, 10)
        // The API refuses to delete a supplier that has purchases, so remove
        // the record through the module service.
        await (getContainer().resolve(SUPPLIER_MODULE) as any).deleteSuppliers(
          ctx.supplier.id
        )
        const { balances } = (await list()).data
        expect(balances).toHaveLength(1)
        expect(balances[0].supplier).toEqual({
          id: ctx.supplier.id,
          name: "(unknown supplier)",
        })
      })

      it("requires authentication", async () => {
        const res = await api.get("/admin/supplier-balances").catch((e) => e.response)
        expect(res.status).toBe(401)
      })
    })
  },
})
