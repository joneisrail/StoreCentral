import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { loadSalesData } from "../../src/api/admin/sales-report/load-sales-data"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"

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
  },
})
