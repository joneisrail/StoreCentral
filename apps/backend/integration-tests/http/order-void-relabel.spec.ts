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

    describe("re-labelling a voided order", () => {
      it("lets a voided order be bulk-fulfilled again with a new label and fulfillment", async () => {
        const fake = installFakeEasyPost(container)
        const { order, fulfillment } = await createOrderWithLabel(fake, "shp_relabel_1")

        await api.post(`/admin/orders/${order.id}/void-label`, {}, adminHeaders)

        fake.quote("shp_relabel_2")
        const res = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: order.id,
                location_id: (await api.get(`/admin/orders/${order.id}?fields=id,*fulfillments`, adminHeaders)).data.order
                  .fulfillments[0].location_id,
                shipment_id: "shp_relabel_2",
                rate_id: "rate_1",
              },
            ],
          },
          adminHeaders
        )

        expect(res.data.failed).toEqual([])
        expect(res.data.succeeded).toEqual([order.id])
        expect(fake.shipments.get("shp_relabel_2")?.purchased).toBe(true)

        const after = (
          await api.get(`/admin/orders/${order.id}?fields=id,fulfillment_status,*fulfillments`, adminHeaders)
        ).data.order
        expect(after.fulfillments).toHaveLength(2)
        const live = after.fulfillments.filter((f) => !f.canceled_at)
        expect(live).toHaveLength(1)
        expect(live[0].id).not.toBe(fulfillment.id)
        expect(live[0].data?.easypost_shipment_id).toBe("shp_relabel_2")
        expect(after.fulfillment_status).toBe("fulfilled")
      })
    })
  },
})
