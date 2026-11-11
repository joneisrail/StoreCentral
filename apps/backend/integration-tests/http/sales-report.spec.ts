import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { loadSalesData } from "../../src/api/admin/sales-report/load-sales-data"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"
import { createSalesOrderHelpers } from "../fixtures/sales-orders"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer, dbConnection }) => {
    const today = () => new Date().toISOString().slice(0, 10)

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
    })

    const seed = async () =>
      (await createOrderSeeder({ api, container: getContainer() })).order as {
        id: string
      }

    describe("order data access", () => {
      it("reads computed totals for a placed order", async () => {
        const seeded = await seed()
        const fields = "+item_subtotal,+discount_subtotal,+shipping_subtotal,+tax_total"
        const admin = (
          await api.get(`/admin/orders/${seeded.id}?fields=${fields}`, adminHeaders)
        ).data.order

        const { orders } = await loadSalesData(getContainer(), {
          from: today(),
          to: today(),
        })
        expect(orders).toHaveLength(1)
        const order = orders[0]
        expect(order.id).toBe(seeded.id)
        expect(Number(order.item_subtotal)).toBe(Number(admin.item_subtotal))
        expect(Number(order.shipping_subtotal)).toBe(Number(admin.shipping_subtotal))
        expect(Number(order.tax_total)).toBe(Number(admin.tax_total))
        expect(Number(order.discount_subtotal)).toBe(Number(admin.discount_subtotal))
        expect(Number(order.item_subtotal)).toBeGreaterThan(0)
        expect(order.items).toHaveLength(1)
        expect(Number(order.items[0].quantity)).toBe(1)
        expect(Number(order.items[0].subtotal)).toBe(Number(admin.items[0].subtotal))
      })

      it("reads refund transactions", async () => {
        const seeded = await seed()
        const orderModule = getContainer().resolve(Modules.ORDER) as any
        await orderModule.addOrderTransactions({
          order_id: seeded.id,
          amount: -5,
          currency_code: "usd",
          reference: "refund",
          reference_id: "ref_test",
        })
        const { refunds } = await loadSalesData(getContainer(), {
          from: today(),
          to: today(),
        })
        expect(refunds).toHaveLength(1)
        expect(Number(refunds[0].amount)).toBe(-5)
      })

      it("excludes canceled orders", async () => {
        const seeded = await seed()
        await api.post(`/admin/orders/${seeded.id}/cancel`, {}, adminHeaders)
        const { orders } = await loadSalesData(getContainer(), {
          from: today(),
          to: today(),
        })
        expect(orders).toHaveLength(0)
      })
    })

    // --- GET /admin/sales-report --------------------------------------------
    const sql = () => getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const report = async (qs = "") =>
      (await api.get(`/admin/sales-report${qs}`, adminHeaders)).data

    const { makeOrder, refund } = createSalesOrderHelpers(getContainer)

    const counts = async () => ({
      orders: Number((await sql().raw('select count(*) from "order"')).rows[0].count),
      tx: Number((await sql().raw("select count(*) from order_transaction")).rows[0].count),
    })

    describe("GET /admin/sales-report", () => {
      it("returns zeros and a full trend when there are no orders", async () => {
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.currency_code).toBe("usd")
        expect(r.range).toEqual({ from: "2026-03-01", to: "2026-03-03", granularity: "day" })
        expect(r.summary.orders).toBe(0)
        expect(r.summary.revenue).toBe(0)
        expect(r.summary.net_revenue).toBe(0)
        expect(r.trend.map((p: any) => p.period)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"])
        expect(r.trend.every((p: any) => p.orders === 0 && p.revenue === 0)).toBe(true)
        expect(r.top_products).toEqual([])
      })

      it("counts a placed order", async () => {
        await makeOrder({
          at: "2026-03-02T10:00:00Z",
          items: [{ title: "Widget", quantity: 3, unit_price: 20, variant_id: "variant_abc", tax: 10 }],
          shipping: 7,
        })
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary).toMatchObject({
          orders: 1,
          units: 3,
          gross_sales: 60,
          discounts: 0,
          net_sales: 60,
          shipping: 7,
          tax: 6,
          revenue: 67,
          refunds: 0,
          net_revenue: 67,
          average_order_value: 67,
        })
        expect(r.trend[1]).toMatchObject({ period: "2026-03-02", orders: 1, revenue: 67 })
        expect(r.top_products).toHaveLength(1)
        expect(r.top_products[0]).toMatchObject({
          variant_id: "variant_abc",
          title: "Widget",
          quantity: 3,
          revenue: 60,
        })
      })

      it("counts an order made by the order seeder", async () => {
        const seeded = await seed()
        const r = await report(`?from=${today()}&to=${today()}`)
        expect(r.summary.orders).toBe(1)
        expect(r.summary.gross_sales).toBeGreaterThan(0)
        expect(r.top_products[0].variant_id).toBeTruthy()
        expect(seeded.id).toBeTruthy()
      })

      it("excludes canceled orders and drafts, and their refunds", async () => {
        const at = "2026-03-02T10:00:00Z"
        const control = await makeOrder({ at })
        const canceled = await makeOrder({ at, canceled: true })
        const draft = await makeOrder({ at, status: "draft" })
        await refund(canceled.id, 40, at)
        await refund(draft.id, 30, at)
        await refund(control.id, 5, at)

        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary.orders).toBe(1)
        expect(r.summary.gross_sales).toBe(100)
        expect(r.summary.refunds).toBe(5)
        expect(r.summary.net_revenue).toBe(95)
      })

      it("ignores orders in another currency", async () => {
        const at = "2026-03-02T10:00:00Z"
        await makeOrder({ at })
        await makeOrder({ at, currency: "eur" })
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary.orders).toBe(1)
        expect(r.summary.gross_sales).toBe(100)
      })

      it("ignores refunds in another currency", async () => {
        const at = "2026-03-02T10:00:00Z"
        const order = await makeOrder({ at })
        await refund(order.id, 9, at, "eur")
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary.refunds).toBe(0)
      })

      it("a refund in range on an order placed before the range counts only in its own bucket", async () => {
        const order = await makeOrder({ at: "2026-02-10T10:00:00Z" })
        await refund(order.id, 25, "2026-03-02T12:00:00Z")
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary.orders).toBe(0)
        expect(r.summary.revenue).toBe(0)
        expect(r.summary.refunds).toBe(25)
        expect(r.summary.net_revenue).toBe(-25)
        expect(r.trend.map((p: any) => p.refunds)).toEqual([0, 25, 0])
      })

      it("a refund dated outside the range is ignored", async () => {
        const order = await makeOrder({ at: "2026-03-02T10:00:00Z" })
        await refund(order.id, 25, "2026-03-04T00:00:00Z")
        await refund(order.id, 11, "2026-02-28T23:59:59Z")
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary.orders).toBe(1)
        expect(r.summary.refunds).toBe(0)
      })

      it("boundary instants", async () => {
        await makeOrder({ at: "2026-03-01T00:00:00.000Z" })
        await makeOrder({ at: "2026-03-03T23:59:59.999Z" })
        await makeOrder({ at: "2026-03-04T00:00:00.000Z" })
        await makeOrder({ at: "2026-02-28T23:59:59.999Z" })
        const r = await report("?from=2026-03-01&to=2026-03-03")
        expect(r.summary.orders).toBe(2)
        expect(r.trend.map((p: any) => p.orders)).toEqual([1, 0, 1])
      })

      it("summary equals the sum of the trend and granularity changes the labels", async () => {
        const dates = [
          "2026-03-02T10:00:00Z", // Monday
          "2026-03-08T10:00:00Z", // Sunday, same week
          "2026-03-09T10:00:00Z", // next Monday
          "2026-04-01T10:00:00Z",
        ]
        for (const [i, at] of dates.entries()) {
          await makeOrder({
            at,
            items: [{ title: "W", quantity: i + 1, unit_price: 10.1, tax: 5 }],
            shipping: 1.3,
          })
        }
        const qs = "?from=2026-03-01&to=2026-04-05"
        const daily = await report(qs)
        const sum = (rows: any[], k: string) =>
          Math.round(rows.reduce((a, p) => a + p[k], 0) * 100) / 100
        for (const k of ["orders", "units", "gross_sales", "shipping", "tax", "revenue"]) {
          expect(daily.summary[k]).toBe(sum(daily.trend, k))
        }
        expect(daily.summary.orders).toBe(4)

        const weekly = await report(`${qs}&granularity=week`)
        expect(weekly.trend.map((p: any) => p.period)).toEqual([
          "2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16",
          "2026-03-23", "2026-03-30",
        ])
        expect(weekly.trend.map((p: any) => p.orders)).toEqual([0, 2, 1, 0, 0, 1])
        expect(weekly.summary).toEqual(daily.summary)

        const monthly = await report(`${qs}&granularity=month`)
        expect(monthly.trend.map((p: any) => p.period)).toEqual(["2026-03", "2026-04"])
        expect(monthly.trend.map((p: any) => p.orders)).toEqual([3, 1])
        expect(monthly.summary).toEqual(daily.summary)
      })

      it("limits top products", async () => {
        const at = "2026-03-02T10:00:00Z"
        await makeOrder({
          at,
          items: [
            { title: "A", quantity: 1, unit_price: 10, variant_id: "v_a" },
            { title: "B", quantity: 1, unit_price: 30, variant_id: "v_b" },
            { title: "C", quantity: 1, unit_price: 20, variant_id: "v_c" },
          ],
        })
        const r = await report("?from=2026-03-01&to=2026-03-03&top=2")
        expect(r.top_products.map((p: any) => p.title)).toEqual(["B", "C"])
      })

      it("returns 30 daily periods by default", async () => {
        const r = await report()
        expect(r.trend).toHaveLength(30)
        expect(r.range.to).toBe(today())
        expect(r.range.granularity).toBe("day")
      })

      describe("validation", () => {
        const bad = async (qs: string) => {
          const res = await api
            .get(`/admin/sales-report${qs}`, adminHeaders)
            .catch((e: any) => e.response)
          expect(res.status).toBe(400)
          expect(typeof res.data.message).toBe("string")
          expect(res.data.message.length).toBeGreaterThan(0)
          return res.data.message as string
        }
        it("rejects from after to", async () => {
          expect(await bad("?from=2026-03-05&to=2026-03-01")).toMatch(/from/)
        })
        it("rejects a range over 366 days", async () => {
          expect(await bad("?from=2025-01-01&to=2026-03-01")).toMatch(/366/)
        })
        it("rejects an impossible date", async () => {
          await bad("?from=2026-02-30&to=2026-03-01")
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
        const order = await makeOrder({ at: "2026-03-02T10:00:00Z" })
        await refund(order.id, 5, "2026-03-02T11:00:00Z")
        const before = await counts()
        await report("?from=2026-03-01&to=2026-03-03")
        await report()
        await api.get("/admin/sales-report?top=0", adminHeaders).catch(() => undefined)
        expect(await counts()).toEqual(before)
      })

      it("requires admin auth", async () => {
        const res = await api.get("/admin/sales-report").catch((e: any) => e.response)
        expect(res.status).toBe(401)
      })
    })
  },
})
