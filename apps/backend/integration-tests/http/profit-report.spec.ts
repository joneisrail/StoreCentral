import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { loadCostData } from "../../src/api/admin/profit-report/load-cost-data"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createSalesOrderHelpers } from "../fixtures/sales-orders"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer, dbConnection }) => {
    let counter = 0
    const { sql, makeOrder, refund } = createSalesOrderHelpers(getContainer)
    const RANGE = "?from=2026-03-01&to=2026-03-06"

    beforeEach(async () => {
      counter = 0
      await createAdminUser(dbConnection, adminHeaders, getContainer())
    })

    const profit = async (qs = RANGE) =>
      (await api.get(`/admin/profit-report${qs}`, adminHeaders)).data
    const sales = async (qs = RANGE) =>
      (await api.get(`/admin/sales-report${qs}`, adminHeaders)).data

    const createSupplier = async () =>
      (await api.post("/admin/suppliers", { name: "Acme" }, adminHeaders)).data
        .supplier as { id: string }

    const createLocation = async () =>
      (await api.post("/admin/stock-locations", { name: "Main" }, adminHeaders))
        .data.stock_location as { id: string }

    // A variant with manage_inventory: true so receiving can raise stock.
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
                sku: `PROFIT-${counter}`,
                manage_inventory: true,
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

    // Creates, places and fully receives a purchase, then sets every receipt
    // to receivedAt with parameterized SQL.
    const receivedPurchase = async (o: {
      lines: { variant_id: string; quantity: number; unit_cost: number }[]
      shipping_cost?: number
      tax?: number
      other_cost?: number
      receivedAt: string
    }) => {
      const supplier = await createSupplier()
      const location = await createLocation()
      const { receivedAt, lines, ...extras } = o
      const created = (
        await api.post(
          "/admin/purchases",
          { supplier_id: supplier.id, items: lines, ...extras },
          adminHeaders
        )
      ).data.purchase
      const placed = (
        await api.post(`/admin/purchases/${created.id}/order`, {}, adminHeaders)
      ).data.purchase as {
        id: string
        items: { id: string; variant_id: string }[]
      }
      await api.post(
        `/admin/purchases/${created.id}/receive`,
        {
          stock_location_id: location.id,
          items: placed.items.map((item) => ({
            purchase_item_id: item.id,
            quantity: lines.find((l) => l.variant_id === item.variant_id)!
              .quantity,
          })),
        },
        adminHeaders
      )
      await sql().raw(
        "update purchase_receipt set received_at = ? where purchase_id = ?",
        [receivedAt, created.id]
      )
      return placed
    }

    const bad = async (qs: string) => {
      const res = await api
        .get(`/admin/profit-report${qs}`, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(typeof res.data.message).toBe("string")
      expect(res.data.message.length).toBeGreaterThan(0)
      return res.data.message as string
    }

    describe("cost data access", () => {
      it("verifies the cost data is readable", async () => {
        const variant = await createVariant()
        const placed = await receivedPurchase({
          lines: [{ variant_id: variant.id, quantity: 10, unit_cost: 4 }],
          shipping_cost: 10,
          tax: 2,
          other_cost: 1,
          receivedAt: "2026-03-01T00:00:00.000Z",
        })

        const purchases = await loadCostData(
          getContainer(),
          new Date("2030-01-01T00:00:00.000Z")
        )
        expect(purchases).toHaveLength(1)
        const p = purchases[0]
        expect(Number(p.shipping_cost)).toBe(10)
        expect(Number(p.tax)).toBe(2)
        expect(Number(p.other_cost)).toBe(1)
        expect(p.items).toHaveLength(1)
        expect(p.items[0]).toMatchObject({
          id: placed.items[0].id,
          variant_id: variant.id,
        })
        expect(Number(p.items[0].quantity)).toBe(10)
        expect(Number(p.items[0].unit_cost)).toBe(4)
        expect(p.receipts).toHaveLength(1)
        expect(new Date(p.receipts[0].received_at).toISOString()).toBe(
          "2026-03-01T00:00:00.000Z"
        )
        expect(p.receipts[0].items).toHaveLength(1)
        expect(p.receipts[0].items[0].purchase_item_id).toBe(placed.items[0].id)
        expect(Number(p.receipts[0].items[0].quantity)).toBe(10)

        // Receipts at or after the range end are not returned.
        expect(
          await loadCostData(
            getContainer(),
            new Date("2026-03-01T00:00:00.000Z")
          )
        ).toHaveLength(0)
      })
    })

    describe("GET /admin/profit-report", () => {
      it("computes exact cost and profit for one order", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 10, unit_cost: 4 }],
          shipping_cost: 10,
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [{ title: "W", quantity: 2, unit_price: 20, variant_id: v.id }],
        })

        const r = await profit()
        const s = await sales()
        expect(r.summary.net_revenue).toBe(s.summary.net_revenue)
        expect(r.summary).toMatchObject({
          orders: 1,
          units: 2,
          net_revenue: 40,
          cogs: 10,
          gross_profit: 30,
          margin_pct: 75,
          units_without_cost: 0,
        })
        expect(r.trend[1]).toMatchObject({
          period: "2026-03-02",
          cogs: 10,
          gross_profit: 30,
        })
      })

      it("treats a sale before the first receipt as uncosted", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 10, unit_cost: 4 }],
          receivedAt: "2026-03-03T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [{ title: "W", quantity: 2, unit_price: 20, variant_id: v.id }],
        })

        const r = await profit()
        expect(r.summary).toMatchObject({
          cogs: 0,
          net_revenue: 40,
          gross_profit: 40,
          units_without_cost: 2,
        })
        expect(r.by_product[0].units_without_cost).toBe(2)
      })

      it("leaves an earlier sale's profit unchanged by a later receipt at a higher price", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 10, unit_cost: 4 }],
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [{ title: "W", quantity: 2, unit_price: 20, variant_id: v.id }],
        })
        const before = await profit()
        expect(before.trend[1].cogs).toBe(8)

        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 10, unit_cost: 10 }],
          receivedAt: "2026-03-04T00:00:00.000Z",
        })
        const after = await profit()
        expect(after.trend[1]).toEqual(before.trend[1])
        expect(after.summary).toEqual(before.summary)
      })

      it("averages two purchases by quantity", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 10, unit_cost: 4 }],
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 30, unit_cost: 8 }],
          receivedAt: "2026-03-02T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-03T10:00:00Z",
          items: [{ title: "W", quantity: 2, unit_price: 20, variant_id: v.id }],
        })
        // (10 * 4 + 30 * 8) / 40 = 7 per unit
        const r = await profit()
        expect(r.summary.cogs).toBe(14)
        expect(r.summary.gross_profit).toBe(26)
      })

      it("includes purchase shipping, tax and other costs in the cost", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 10, unit_cost: 4 }],
          shipping_cost: 5,
          tax: 3,
          other_cost: 2,
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [{ title: "W", quantity: 4, unit_price: 20, variant_id: v.id }],
        })
        // landed 4 * (1 + 10 / 40) = 5 per unit
        const r = await profit()
        expect(r.summary.cogs).toBe(20)
        expect(r.summary.gross_profit).toBe(60)
      })

      it("excludes canceled, draft and non-USD orders, and equals the sales net revenue", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 20, unit_cost: 4 }],
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        const at = "2026-03-02T10:00:00Z"
        const items = [
          { title: "W", quantity: 2, unit_price: 20, variant_id: v.id },
        ]
        const control = await makeOrder({ at, items })
        const canceled = await makeOrder({ at, items, canceled: true })
        const draft = await makeOrder({ at, items, status: "draft" })
        await makeOrder({ at, items, currency: "eur" })
        await refund(canceled.id, 40, at)
        await refund(draft.id, 30, at)
        await refund(control.id, 5, at)

        const r = await profit()
        const s = await sales()
        expect(r.summary.orders).toBe(1)
        expect(r.summary.units).toBe(2)
        expect(r.summary.cogs).toBe(8)
        expect(r.summary.net_revenue).toBe(35)
        expect(r.summary.net_revenue).toBe(s.summary.net_revenue)
        expect(r.trend.map((p: any) => p.net_revenue)).toEqual(
          s.trend.map((p: any) => p.net_revenue)
        )
        expect(r.summary.gross_profit).toBe(27)
      })

      it("orders by_product by gross profit and limits it with top", async () => {
        const x = await createVariant()
        const y = await createVariant()
        const z = await createVariant()
        await receivedPurchase({
          lines: [
            { variant_id: x.id, quantity: 10, unit_cost: 4 },
            { variant_id: y.id, quantity: 10, unit_cost: 10 },
          ],
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [
            { title: "Y", quantity: 1, unit_price: 30, variant_id: y.id },
            { title: "Z", quantity: 1, unit_price: 15, variant_id: z.id },
            { title: "X", quantity: 2, unit_price: 20, variant_id: x.id },
          ],
        })

        const r = await profit()
        expect(r.by_product.map((p: any) => p.title)).toEqual(["X", "Y", "Z"])
        expect(r.by_product[0]).toMatchObject({
          variant_id: x.id,
          units: 2,
          revenue: 40,
          cogs: 8,
          gross_profit: 32,
          margin_pct: 80,
          units_without_cost: 0,
        })
        expect(r.by_product[1]).toMatchObject({
          revenue: 30,
          cogs: 10,
          gross_profit: 20,
        })
        expect(r.by_product[2]).toMatchObject({
          revenue: 15,
          cogs: 0,
          gross_profit: 15,
          units_without_cost: 1,
        })

        const top = await profit(`${RANGE}&top=2`)
        expect(top.by_product.map((p: any) => p.title)).toEqual(["X", "Y"])
      })

      it("returns zeros, a full zero-filled trend and an empty by_product when there is no data", async () => {
        const r = await profit("?from=2026-03-01&to=2026-03-03")
        expect(r.currency_code).toBe("usd")
        expect(r.range).toEqual({
          from: "2026-03-01",
          to: "2026-03-03",
          granularity: "day",
        })
        expect(r.summary).toEqual({
          orders: 0,
          units: 0,
          net_revenue: 0,
          cogs: 0,
          gross_profit: 0,
          margin_pct: null,
          units_without_cost: 0,
        })
        expect(r.trend.map((p: any) => p.period)).toEqual([
          "2026-03-01",
          "2026-03-02",
          "2026-03-03",
        ])
        expect(
          r.trend.every((p: any) => p.cogs === 0 && p.net_revenue === 0)
        ).toBe(true)
        expect(r.by_product).toEqual([])
      })

      describe("validation", () => {
        it("rejects from after to", async () => {
          expect(await bad("?from=2026-03-05&to=2026-03-01")).toMatch(/from/)
        })
        it("rejects a range over 366 days", async () => {
          expect(await bad("?from=2025-01-01&to=2026-03-01")).toMatch(/366/)
        })
        it("rejects an unknown granularity", async () => {
          await bad("?granularity=year")
        })
        it("rejects top out of 1-50", async () => {
          await bad("?top=0")
          await bad("?top=51")
        })
      })

      it("is read-only", async () => {
        const v = await createVariant()
        await receivedPurchase({
          lines: [{ variant_id: v.id, quantity: 5, unit_cost: 2 }],
          receivedAt: "2026-03-01T00:00:00.000Z",
        })
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [{ title: "W", quantity: 1, unit_price: 9, variant_id: v.id }],
        })
        const count = async (table: string) =>
          Number(
            (await sql().raw(`select count(*) from "${table}"`)).rows[0].count
          )
        const counts = async () => ({
          orders: await count("order"),
          purchases: await count("purchase"),
          receipts: await count("purchase_receipt"),
          receipt_items: await count("purchase_receipt_item"),
        })
        const before = await counts()
        await profit()
        await profit()
        await api
          .get("/admin/profit-report?top=0", adminHeaders)
          .catch(() => undefined)
        expect(await counts()).toEqual(before)
      })

      it("requires admin auth", async () => {
        const res = await api
          .get("/admin/profit-report")
          .catch((e: any) => e.response)
        expect(res.status).toBe(401)
      })
    })
  },
})
