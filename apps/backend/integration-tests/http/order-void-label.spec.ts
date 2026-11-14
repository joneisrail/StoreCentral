import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ProductStatus } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { installFakeEasyPost } from "../fixtures/fake-easypost"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

medusaIntegrationTestRunner({
  env: {
    EASYPOST_API_KEY: "EZTKtest_00000000000000000000000000000000",
  },
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let skuCounter = 0

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    const createFulfillableOrder = async () => {
      const suffix = `void-label-order-${skuCounter++}`
      const inventoryItemOverride = (
        await api.post(`/admin/inventory-items`, { sku: `${suffix}-inventory` }, adminHeaders)
      ).data.inventory_item
      const shippingProfileOverride = (
        await api.post(`/admin/shipping-profiles`, { name: `${suffix}-profile`, type: "default" }, adminHeaders)
      ).data.shipping_profile
      const productOverride = (
        await api.post(
          "/admin/products",
          {
            title: `Test fixture ${suffix}`,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfileOverride.id,
            options: [
              { title: "size", values: ["large", "small"] },
              { title: "color", values: ["green"] },
            ],
            variants: [
              {
                title: "Test variant",
                sku: `${suffix}-variant`,
                inventory_items: [{ inventory_item_id: inventoryItemOverride.id, required_quantity: 1 }],
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "large", color: "green" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      return createOrderSeeder({
        api,
        container,
        productOverride,
        inventoryItemOverride,
        shippingProfileOverride,
      })
    }

    // Buys a label for a fresh order through the real bulk-fulfill route.
    const createOrderWithLabel = async (fake: ReturnType<typeof installFakeEasyPost>, shipmentId: string) => {
      fake.quote(shipmentId)
      const seeder = await createFulfillableOrder()
      const res = await api.post(
        "/admin/orders/fulfillments/batch",
        {
          fulfillments: [
            {
              order_id: seeder.order.id,
              location_id: seeder.stockLocation.id,
              shipment_id: shipmentId,
              rate_id: "rate_1",
            },
          ],
        },
        adminHeaders
      )
      expect(res.data.succeeded).toEqual([seeder.order.id])
      const order = (
        await api.get(`/admin/orders/${seeder.order.id}?fields=id,*fulfillments,*items`, adminHeaders)
      ).data.order
      return { seeder, order, fulfillment: order.fulfillments[0] }
    }

    describe("POST /admin/orders/:id/void-label", () => {
      it("voids a bought label: refunds it, cancels the fulfillment and reopens the order", async () => {
        const fake = installFakeEasyPost(container)
        const { order, fulfillment } = await createOrderWithLabel(fake, "shp_void_1")

        const res = await api.post(`/admin/orders/${order.id}/void-label`, {}, adminHeaders)
        expect(res.status).toBe(200)
        expect(res.data.order_id).toBe(order.id)
        expect(res.data.voided).toEqual([{ fulfillment_id: fulfillment.id, refund_status: null }])
        expect(fake.client.refundShipment).toHaveBeenCalledWith("shp_void_1")

        const after = (
          await api.get(`/admin/orders/${order.id}?fields=id,fulfillment_status,*fulfillments,*items,*items.detail`, adminHeaders)
        ).data.order
        expect(after.fulfillments[0].canceled_at).toBeTruthy()
        // Core derives "canceled" when every fulfillment is canceled (an open state: nothing shipped, items are unfulfilled again).
        expect(after.fulfillment_status).toBe("canceled")
        expect(after.items.every((i) => !i.detail?.fulfilled_quantity)).toBe(true)

        const again = await api.post(`/admin/orders/${order.id}/void-label`, {}, adminHeaders).catch((e) => e.response)
        expect(again.status).toBe(400)
      })

      it("rejects a shipped order", async () => {
        const fake = installFakeEasyPost(container)
        const { order, fulfillment } = await createOrderWithLabel(fake, "shp_void_2")
        await api.post(
          `/admin/orders/${order.id}/fulfillments/${fulfillment.id}/shipments`,
          { items: order.items.map((i) => ({ id: i.id, quantity: i.quantity })) },
          adminHeaders
        )

        const res = await api.post(`/admin/orders/${order.id}/void-label`, {}, adminHeaders).catch((e) => e.response)
        expect(res.status).toBe(400)
        expect(fake.client.refundShipment).not.toHaveBeenCalled()
      })

      it("rejects an order without a label and an unknown order", async () => {
        installFakeEasyPost(container)
        const seeder = await createFulfillableOrder()
        const none = await api
          .post(`/admin/orders/${seeder.order.id}/void-label`, {}, adminHeaders)
          .catch((e) => e.response)
        expect(none.status).toBe(400)

        const missing = await api.post(`/admin/orders/order_missing/void-label`, {}, adminHeaders).catch((e) => e.response)
        expect(missing.status).toBe(404)
      })
    })
  },
})
