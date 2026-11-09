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

    const createVariant = async (manageInventory = false) => {
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
                manage_inventory: manageInventory,
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

    const orderedPurchase = async (supplierId: string, variantId: string) => {
      const created = (
        await api.post(
          "/admin/purchases",
          {
            supplier_id: supplierId,
            items: [{ variant_id: variantId, quantity: 10, unit_cost: 2 }],
          },
          adminHeaders
        )
      ).data.purchase
      await api.post(`/admin/purchases/${created.id}/order`, {}, adminHeaders)
      return created as { id: string }
    }

    type Ctx = {
      supplier: { id: string; name: string }
      variant: { id: string }
      purchase: { id: string }
    }

    const setup = async (
      supplierName = "Acme",
      manageInventory = false
    ): Promise<Ctx> => {
      const supplier = await createSupplier(supplierName)
      const variant = await createVariant(manageInventory)
      const purchase = await orderedPurchase(supplier.id, variant.id)
      return { supplier, variant, purchase }
    }

    // An invoice with one line costing `total` (quantity 1), posted unless
    // asked otherwise.
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
      const invoice = made.data.invoice as {
        id: string
        reference: string
        invoice_number: string
        total: number
      }
      if (action !== "draft") {
        await api.post(`/admin/invoices/${invoice.id}/post`, {}, adminHeaders)
      }
      if (action === "void") {
        await api.post(`/admin/invoices/${invoice.id}/void`, {}, adminHeaders)
      }
      return invoice
    }

    const pay = (body: Record<string, unknown>) =>
      api.post("/admin/supplier-payments", body, adminHeaders).catch((e) => e.response)

    const body = (
      invoiceId: string,
      amount: number,
      over: Record<string, unknown> = {}
    ) => ({
      invoice_id: invoiceId,
      amount,
      paid_at: "2026-11-05",
      method: "bank_transfer",
      ...over,
    })

    const voidPayment = (id: string) =>
      api
        .post(`/admin/supplier-payments/${id}/void`, {}, adminHeaders)
        .catch((e) => e.response)

    const countPayments = async () => {
      const [, count] = await accounting().listAndCountPayments({})
      return count as number
    }

    describe("POST /admin/supplier-payments", () => {
      it("records a payment against a posted invoice", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10.5)

        const response = await pay(
          body(invoice.id, 4.25, {
            method: "cheque",
            reference: "  CHQ-77 ",
            note: " first part ",
          })
        )

        expect(response.status).toBe(200)
        const payment = response.data.payment
        expect(payment).toEqual({
          id: expect.any(String),
          reference: "PAY-0001",
          invoice: {
            id: invoice.id,
            reference: invoice.reference,
            invoice_number: invoice.invoice_number,
          },
          supplier: { id: ctx.supplier.id, name: "Acme" },
          amount: 4.25,
          paid_at: "2026-11-05",
          method: "cheque",
          payment_reference: "CHQ-77",
          note: "first part",
          status: "recorded",
          voided_at: null,
          created_at: expect.any(String),
        })
        expect(typeof payment.amount).toBe("number")

        const stored = await accounting().retrievePayment(payment.id)
        expect(stored.supplier_id).toBe(ctx.supplier.id)
        expect(stored.invoice_id).toBe(invoice.id)
        expect(Number(stored.amount)).toBe(4.25)
      })

      it("stores blank reference and note as null", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)

        const response = await pay(
          body(invoice.id, 1, { reference: "   ", note: "" })
        )

        expect(response.status).toBe(200)
        expect(response.data.payment.payment_reference).toBeNull()
        expect(response.data.payment.note).toBeNull()
      })

      it("refuses a draft invoice and a void invoice", async () => {
        const ctx = await setup()
        const draft = await invoiceFor(ctx, 10, "draft")
        const voided = await invoiceFor(ctx, 10, "void")

        const a = await pay(body(draft.id, 1))
        const b = await pay(body(voided.id, 1))

        expect(a.status).toBe(400)
        expect(a.data.message).toContain("draft")
        expect(b.status).toBe(400)
        expect(b.data.message).toContain("void")
        expect(await countPayments()).toBe(0)
      })

      it("returns 404 for an unknown invoice", async () => {
        const response = await pay(body("inv_missing", 1))
        expect(response.status).toBe(404)
      })

      it("refuses zero, negative and three-decimal amounts", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)

        for (const amount of [0, -1, 1.234]) {
          const response = await pay(body(invoice.id, amount))
          expect(response.status).toBe(400)
          expect(response.data.message).toMatch(/amount/i)
        }
        expect(await countPayments()).toBe(0)
      })

      it("refuses an amount over the balance and names the balance", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10.5)

        const response = await pay(body(invoice.id, 12))

        expect(response.status).toBe(400)
        expect(response.data.message).toBe(
          "Amount 12.00 exceeds the invoice balance 10.50"
        )
        expect(await countPayments()).toBe(0)
      })

      it("accepts the exact balance", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10.5)

        expect((await pay(body(invoice.id, 10.5))).status).toBe(200)
        const more = await pay(body(invoice.id, 0.01))
        expect(more.status).toBe(400)
        expect(more.data.message).toContain("balance 0.00")
      })

      it("limits a second payment to the remaining balance", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        expect((await pay(body(invoice.id, 7))).status).toBe(200)

        const over = await pay(body(invoice.id, 3.01))
        expect(over.status).toBe(400)
        expect(over.data.message).toBe(
          "Amount 3.01 exceeds the invoice balance 3.00"
        )
        expect((await pay(body(invoice.id, 3))).status).toBe(200)
      })

      it("compares in whole cents (0.10 + 0.20 pays 0.30)", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 0.3)

        expect((await pay(body(invoice.id, 0.1))).status).toBe(200)
        expect((await pay(body(invoice.id, 0.2))).status).toBe(200)
        const third = await pay(body(invoice.id, 0.01))
        expect(third.status).toBe(400)
        expect(third.data.message).toContain("balance 0.00")
      })

      it("rounds a float-noise amount to whole cents before storing", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 0.3)

        // 0.1 + 0.2 is 0.30000000000000004 in floating point.
        const response = await pay(body(invoice.id, 0.1 + 0.2))

        expect(response.status).toBe(200)
        expect(response.data.payment.amount).toBe(0.3)
        const stored = await accounting().retrievePayment(response.data.payment.id)
        expect(Number(stored.amount)).toBe(0.3)
      })

      it("counts every existing payment, not just the first page", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 1)
        await accounting().createPayments(
          Array.from({ length: 60 }, () => ({
            invoice_id: invoice.id,
            supplier_id: ctx.supplier.id,
            amount: 0.01,
            paid_at: new Date("2026-11-02"),
            method: "cash",
          }))
        )

        const over = await pay(body(invoice.id, 0.41))
        expect(over.status).toBe(400)
        expect(over.data.message).toContain("balance 0.40")
        expect((await pay(body(invoice.id, 0.4))).status).toBe(200)
      })

      it("rejects a blank method, an unknown method and a bad date", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)

        for (const over of [
          { method: "" },
          { method: "bitcoin" },
          { paid_at: "2026-13-45" },
          { paid_at: "11/05/2026" },
          { paid_at: undefined },
        ]) {
          const response = await pay(body(invoice.id, 1, over))
          expect(response.status).toBe(400)
        }
        expect(await countPayments()).toBe(0)
      })

      it("rejects an unauthenticated request with 401", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)

        const response = await api
          .post("/admin/supplier-payments", body(invoice.id, 1))
          .catch((e) => e.response)

        expect(response.status).toBe(401)
        expect(await countPayments()).toBe(0)
      })

      it("two concurrent payments of 60% each: exactly one succeeds", async () => {
        const ctx = await setup()
        for (let i = 0; i < 3; i++) {
          const invoice = await invoiceFor(ctx, 10)

          const responses = await Promise.all([
            pay(body(invoice.id, 6)),
            pay(body(invoice.id, 6)),
          ])

          expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
          const [, count] = await accounting().listAndCountPayments({
            invoice_id: invoice.id,
          })
          expect(count).toBe(1)
        }
      })

      it("leaves no payment behind when the insert fails", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)

        const spy = jest
          .spyOn(accounting(), "createPayments")
          .mockRejectedValueOnce(new Error("payment create failed"))
        let response: any
        try {
          response = await pay(body(invoice.id, 4))
        } finally {
          spy.mockRestore()
        }

        expect(response.status).toBe(500)
        expect(await countPayments()).toBe(0)
        // The full balance is still open.
        expect((await pay(body(invoice.id, 10))).status).toBe(200)
      })
    })

    describe("POST /admin/supplier-payments/:id/void", () => {
      it("voids a payment and frees its amount", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const first = (await pay(body(invoice.id, 10))).data.payment
        const before = Date.now()

        const response = await voidPayment(first.id)

        expect(response.status).toBe(200)
        expect(response.data.payment.id).toBe(first.id)
        expect(response.data.payment.status).toBe("void")
        expect(
          new Date(response.data.payment.voided_at).getTime()
        ).toBeGreaterThanOrEqual(before - 1000)
        expect((await pay(body(invoice.id, 10))).status).toBe(200)
      })

      it("refuses voiding twice and keeps voided_at", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const payment = (await pay(body(invoice.id, 5))).data.payment
        const first = await voidPayment(payment.id)

        const second = await voidPayment(payment.id)

        expect(second.status).toBe(400)
        expect(second.data.message).toContain("already void")
        const after = (
          await api.get(`/admin/supplier-payments/${payment.id}`, adminHeaders)
        ).data.payment
        expect(after.voided_at).toBe(first.data.payment.voided_at)
      })

      it("two concurrent voids yield exactly one 200 and one 400", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const payment = (await pay(body(invoice.id, 5))).data.payment

        const responses = await Promise.all([
          voidPayment(payment.id),
          voidPayment(payment.id),
        ])

        expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
      })

      it("returns 404 for an unknown id", async () => {
        expect((await voidPayment("pay_missing")).status).toBe(404)
      })
    })

    describe("GET /admin/supplier-payments", () => {
      const list = (qs = "") =>
        api.get(`/admin/supplier-payments${qs}`, adminHeaders).catch((e) => e.response)

      const record = async (
        invoiceId: string,
        amount: number,
        over: Record<string, unknown> = {}
      ) => {
        // A small gap keeps created_at distinct.
        await new Promise((resolve) => setTimeout(resolve, 20))
        const response = await pay(body(invoiceId, amount, over))
        expect(response.status).toBe(200)
        return response.data.payment as { id: string }
      }

      it("lists newest first with supplier and invoice, and counts", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const a = await record(invoice.id, 1)
        const b = await record(invoice.id, 2)

        const response = await list()

        expect(response.status).toBe(200)
        expect(response.data.count).toBe(2)
        expect(response.data.offset).toBe(0)
        expect(response.data.limit).toBe(20)
        expect(response.data.payments.map((p: any) => p.id)).toEqual([
          b.id,
          a.id,
        ])
        expect(response.data.payments[0]).toMatchObject({
          amount: 2,
          supplier: { id: ctx.supplier.id, name: "Acme" },
          invoice: {
            id: invoice.id,
            reference: invoice.reference,
            invoice_number: invoice.invoice_number,
          },
        })
      })

      it("filters by invoice, supplier, status and method", async () => {
        const acme = await setup("Acme")
        const zen = await setup("Zen")
        const inv1 = await invoiceFor(acme, 10)
        const inv2 = await invoiceFor(acme, 10)
        const inv3 = await invoiceFor(zen, 10)
        const p1 = await record(inv1.id, 1, { method: "cash" })
        const p2 = await record(inv2.id, 1, { method: "card" })
        const p3 = await record(inv3.id, 1, { method: "cash" })
        await voidPayment(p2.id)

        const ids = async (qs: string) =>
          ((await list(qs)).data.payments as any[]).map((p) => p.id).sort()

        expect(await ids(`?invoice_id=${inv1.id}`)).toEqual([p1.id])
        expect(await ids(`?supplier_id=${acme.supplier.id}`)).toEqual(
          [p1.id, p2.id].sort()
        )
        expect(await ids("?status=void")).toEqual([p2.id])
        expect(await ids("?status=recorded")).toEqual([p1.id, p3.id].sort())
        expect(await ids("?method=cash")).toEqual([p1.id, p3.id].sort())
        expect((await list("?status=paid")).status).toBe(400)
        expect((await list("?method=bitcoin")).status).toBe(400)
      })

      it("searches payment_reference case-insensitively with % and _ literal", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 100)
        const pct = await record(invoice.id, 1, { reference: "50%OFF" })
        await record(invoice.id, 1, { reference: "50XOFF" })
        const under = await record(invoice.id, 1, { reference: "A_B" })
        await record(invoice.id, 1, { reference: "AXB" })
        await record(invoice.id, 1)

        const ids = async (qs: string) =>
          ((await list(qs)).data.payments as any[]).map((p) => p.id)

        expect(await ids(`?q=${encodeURIComponent("50%off")}`)).toEqual([
          pct.id,
        ])
        expect(await ids("?q=a_b")).toEqual([under.id])
        expect(await ids(`?q=${encodeURIComponent("  a_b ")}`)).toEqual([
          under.id,
        ])
        expect((await list(`?q=${encodeURIComponent("   ")}`)).data.count).toBe(
          5
        )
      })

      it("paginates with a stable order", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const made: string[] = []
        for (let i = 0; i < 5; i++) {
          made.push((await record(invoice.id, 1)).id)
        }

        const first = await list("?limit=2&offset=0")
        const second = await list("?limit=2&offset=2")
        const third = await list("?limit=2&offset=4")

        expect(first.data.count).toBe(5)
        expect(first.data.limit).toBe(2)
        expect(second.data.offset).toBe(2)
        const seen = [
          ...first.data.payments,
          ...second.data.payments,
          ...third.data.payments,
        ].map((p: any) => p.id)
        expect(seen).toEqual([...made].reverse())
        expect((await list("?limit=0")).status).toBe(400)
        expect((await list("?limit=101")).status).toBe(400)
      })

      it("returns every payment of an invoice beyond the default page size", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        await accounting().createPayments(
          Array.from({ length: 60 }, () => ({
            invoice_id: invoice.id,
            supplier_id: ctx.supplier.id,
            amount: 0.01,
            paid_at: new Date("2026-11-02"),
            method: "cash",
          }))
        )

        const response = await list(`?invoice_id=${invoice.id}&limit=100`)

        expect(response.data.count).toBe(60)
        expect(response.data.payments).toHaveLength(60)
      })
    })

    describe("GET /admin/supplier-payments/:id", () => {
      it("returns one payment with invoice and supplier", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const made = (await pay(body(invoice.id, 3))).data.payment

        const response = await api.get(
          `/admin/supplier-payments/${made.id}`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.payment).toEqual(made)
      })

      it("returns 404 for an unknown id", async () => {
        const response = await api
          .get("/admin/supplier-payments/pay_missing", adminHeaders)
          .catch((e) => e.response)
        expect(response.status).toBe(404)
      })
    })

    it("leaves stock levels unchanged by recording and voiding", async () => {
      const ctx = await setup("Acme", true)
      const location = (
        await api.post("/admin/stock-locations", { name: "Main" }, adminHeaders)
      ).data.stock_location
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory_item_id"],
        filters: { id: ctx.variant.id },
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
      const invoice = await invoiceFor(ctx, 10)
      const before = await levels()

      const made = await pay(body(invoice.id, 5))
      expect(made.status).toBe(200)
      expect(await levels()).toEqual(before)
      expect((await voidPayment(made.data.payment.id)).status).toBe(200)
      expect(await levels()).toEqual(before)
      expect(before[0].stocked_quantity).toBe(7)
    })

    describe("payment fields on invoices", () => {
      const listInvoices = (qs = "") =>
        api.get(`/admin/invoices${qs}`, adminHeaders).catch((e) => e.response)
      const getInvoice = (id: string) =>
        api.get(`/admin/invoices/${id}`, adminHeaders).catch((e) => e.response)
      const voidInvoice = (id: string) =>
        api
          .post(`/admin/invoices/${id}/void`, {}, adminHeaders)
          .catch((e) => e.response)
      const byId = async (id: string) =>
        (await listInvoices("?limit=100")).data.invoices.find(
          (i: any) => i.id === id
        )

      it("shows unpaid, part paid and paid on the list and detail", async () => {
        const ctx = await setup()
        const unpaid = await invoiceFor(ctx, 10)
        const part = await invoiceFor(ctx, 10)
        const full = await invoiceFor(ctx, 10)
        expect((await pay(body(part.id, 4))).status).toBe(200)
        expect((await pay(body(full.id, 6))).status).toBe(200)
        expect((await pay(body(full.id, 4))).status).toBe(200)

        const expected: [{ id: string }, object][] = [
          [unpaid, { paid_total: 0, balance: 10, payment_status: "unpaid" }],
          [part, { paid_total: 4, balance: 6, payment_status: "partially_paid" }],
          [full, { paid_total: 10, balance: 0, payment_status: "paid" }],
        ]
        for (const [invoice, fields] of expected) {
          expect(await byId(invoice.id)).toMatchObject(fields)
          expect((await getInvoice(invoice.id)).data.invoice).toMatchObject(
            fields
          )
        }
      })

      it("does not count a voided payment", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const first = await pay(body(invoice.id, 10))
        expect((await voidPayment(first.data.payment.id)).status).toBe(200)
        expect((await pay(body(invoice.id, 3))).status).toBe(200)

        expect(await byId(invoice.id)).toMatchObject({
          paid_total: 3,
          balance: 7,
          payment_status: "partially_paid",
        })
      })

      it("has a null payment status and no overdue on a draft and a void invoice", async () => {
        const ctx = await setup()
        const draft = await invoiceFor(ctx, 10, "draft", "2020-01-01")
        const voided = await invoiceFor(ctx, 10, "void", "2020-01-01")

        for (const invoice of [draft, voided]) {
          expect(await byId(invoice.id)).toMatchObject({
            payment_status: null,
            overdue: false,
          })
        }
      })

      it("is overdue past the due date with a balance, not once paid or on the due date", async () => {
        const ctx = await setup()
        const today = new Date().toISOString().slice(0, 10)
        const late = await invoiceFor(ctx, 10, "post", "2020-01-01")
        const settled = await invoiceFor(ctx, 10, "post", "2020-01-01")
        const dueToday = await invoiceFor(ctx, 10, "post", today)
        const noDue = await invoiceFor(ctx, 10)
        await pay(body(settled.id, 10))

        expect((await byId(late.id)).overdue).toBe(true)
        expect((await byId(settled.id)).overdue).toBe(false)
        expect((await byId(dueToday.id)).overdue).toBe(false)
        expect((await byId(noDue.id)).overdue).toBe(false)
        expect((await getInvoice(late.id)).data.invoice.overdue).toBe(true)
      })

      it("returns payments newest first on the detail, in the payment shape", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        const ids: string[] = []
        for (const amount of [1, 2, 3]) {
          await new Promise((resolve) => setTimeout(resolve, 20))
          ids.push((await pay(body(invoice.id, amount))).data.payment.id)
        }
        await voidPayment(ids[1])

        const { payments } = (await getInvoice(invoice.id)).data
        expect(payments.map((p: any) => p.id)).toEqual([
          ids[2],
          ids[1],
          ids[0],
        ])
        expect(payments[0]).toMatchObject({
          reference: expect.stringMatching(/^PAY-/),
          amount: 3,
          status: "recorded",
          invoice: { id: invoice.id, invoice_number: invoice.invoice_number },
        })
        expect(payments[1].status).toBe("void")
        const empty = await invoiceFor(ctx, 5)
        expect((await getInvoice(empty.id)).data.payments).toEqual([])
      })

      it("counts every payment of an invoice (60, no default-take truncation)", async () => {
        const ctx = await setup()
        const invoice = await invoiceFor(ctx, 10)
        for (let i = 0; i < 60; i += 1) {
          await accounting().createPayments({
            invoice_id: invoice.id,
            supplier_id: ctx.supplier.id,
            amount: 0.01,
            paid_at: new Date("2026-11-05"),
            method: "cash",
          })
        }

        expect(await byId(invoice.id)).toMatchObject({
          paid_total: 0.6,
          balance: 9.4,
        })
        const detail = await getInvoice(invoice.id)
        expect(detail.data.invoice.paid_total).toBe(0.6)
        expect(detail.data.payments).toHaveLength(60)
        expect(
          (await listInvoices("?payment_status=partially_paid")).data
            .invoices[0]
        ).toMatchObject({ id: invoice.id, paid_total: 0.6 })
      })

      describe("payment_status filter", () => {
        const setupFilter = async () => {
          const a = await setup("Acme")
          const b = await setup("Beta")
          // Created oldest to newest; the list is newest first.
          const late = await invoiceFor(a, 10, "post", "2020-01-01")
          const part = await invoiceFor(a, 10, "post", "2099-01-01")
          const paid = await invoiceFor(a, 10, "post", "2020-01-01")
          const other = await invoiceFor(b, 10, "post", "2020-01-01")
          const draft = await invoiceFor(a, 10, "draft", "2020-01-01")
          const voided = await invoiceFor(a, 10, "void", "2020-01-01")
          await pay(body(part.id, 4))
          await pay(body(paid.id, 10))
          return { a, b, late, part, paid, other, draft, voided }
        }
        const ids = async (qs: string) =>
          (await listInvoices(qs)).data.invoices.map((i: any) => i.id)

        it("filters by each value, never matching a draft or void invoice", async () => {
          const f = await setupFilter()

          expect(await ids("?payment_status=unpaid")).toEqual([
            f.other.id,
            f.late.id,
          ])
          expect(await ids("?payment_status=partially_paid")).toEqual([
            f.part.id,
          ])
          expect(await ids("?payment_status=paid")).toEqual([f.paid.id])
          expect(await ids("?payment_status=overdue")).toEqual([
            f.other.id,
            f.late.id,
          ])
          expect((await listInvoices("?payment_status=bogus")).status).toBe(400)
        })

        it("combines with supplier_id and status and counts the filtered total", async () => {
          const f = await setupFilter()

          const response = await listInvoices(
            `?payment_status=overdue&supplier_id=${f.a.supplier.id}`
          )
          expect(response.data.count).toBe(1)
          expect(response.data.invoices.map((i: any) => i.id)).toEqual([
            f.late.id,
          ])
          expect(
            (await listInvoices("?payment_status=unpaid&status=draft")).data
              .count
          ).toBe(0)
        })

        it("paginates the filtered rows with a filtered count", async () => {
          const f = await setupFilter()

          const page = (offset: number) =>
            listInvoices(`?payment_status=unpaid&limit=1&offset=${offset}`)
          const page1 = await page(0)
          const page2 = await page(1)
          const page3 = await page(2)
          expect(page1.data.count).toBe(2)
          expect(page1.data.limit).toBe(1)
          expect(page2.data.offset).toBe(1)
          expect(page1.data.invoices.map((i: any) => i.id)).toEqual([
            f.other.id,
          ])
          expect(page2.data.invoices.map((i: any) => i.id)).toEqual([f.late.id])
          expect(page3.data.invoices).toEqual([])
          expect(page3.data.count).toBe(2)
        })
      })

      describe("voiding an invoice with payments", () => {
        it("is refused while a payment is live, naming the count, and allowed after it is voided", async () => {
          const ctx = await setup()
          const invoice = await invoiceFor(ctx, 10)
          await pay(body(invoice.id, 3))
          await pay(body(invoice.id, 2))

          const refused = await voidInvoice(invoice.id)
          expect(refused.status).toBe(400)
          expect(refused.data.message).toBe(
            `Invoice ${invoice.invoice_number} has 2 payment(s); void the payments first`
          )
          expect((await getInvoice(invoice.id)).data.invoice.status).toBe(
            "posted"
          )

          const all = (await getInvoice(invoice.id)).data.payments
          for (const p of all) {
            await voidPayment(p.id)
          }
          expect((await voidInvoice(invoice.id)).status).toBe(200)
          expect((await getInvoice(invoice.id)).data.invoice.status).toBe(
            "void"
          )
        })

        it("still voids an invoice without payments", async () => {
          const ctx = await setup()
          const invoice = await invoiceFor(ctx, 10)
          expect((await voidInvoice(invoice.id)).status).toBe(200)
        })

        it.each([1, 2, 3])(
          "a concurrent payment and void: exactly one wins (run %i)",
          async () => {
            const ctx = await setup()
            const invoice = await invoiceFor(ctx, 10)

            const [paid, voided] = await Promise.all([
              pay(body(invoice.id, 5)),
              voidInvoice(invoice.id),
            ])

            expect([paid.status, voided.status].sort()).toEqual([200, 400])
            const after = await getInvoice(invoice.id)
            const live = after.data.payments.filter(
              (p: any) => p.status === "recorded"
            )
            if (paid.status === 200) {
              expect(after.data.invoice.status).toBe("posted")
              expect(live).toHaveLength(1)
            } else {
              expect(after.data.invoice.status).toBe("void")
              expect(live).toHaveLength(0)
            }
          }
        )
      })
    })
  },
})
