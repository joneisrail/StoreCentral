import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ModuleRegistrationName, ProductStatus } from "@medusajs/utils"
import {
  adminHeaders,
  createAdminUser,
} from "../fixtures/create-admin-user"
import { setupTaxStructure } from "../fixtures/tax"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container

    beforeAll(async () => {
      container = getContainer()

      await setupTaxStructure(container.resolve(ModuleRegistrationName.TAX))
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    describe("filter by fulfillment_status and payment_status", () => {
      // createOrderSeeder's default product/inventory-item creation uses a
      // hardcoded sku ("test-variant"), so a second call within the same
      // test collides. Build distinct, uniquely-skued fixtures per order so
      // three independent orders can be created in this single test.
      const createDistinctOrderSeeder = async (suffix: string) => {
        const distinctShippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: `Test-ready-to-ship-${suffix}`, type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        const distinctInventoryItem = (
          await api.post(
            `/admin/inventory-items`,
            { sku: `test-variant-ready-to-ship-${suffix}` },
            adminHeaders
          )
        ).data.inventory_item

        const distinctProduct = (
          await api.post(
            "/admin/products",
            {
              title: `Test fixture ready-to-ship ${suffix}`,
              status: ProductStatus.PUBLISHED,
              shipping_profile_id: distinctShippingProfile.id,
              options: [
                { title: "size", values: ["large", "small"] },
                { title: "color", values: ["green"] },
              ],
              variants: [
                {
                  title: "Test variant",
                  sku: `test-variant-ready-to-ship-${suffix}`,
                  inventory_items: [
                    {
                      inventory_item_id: distinctInventoryItem.id,
                      required_quantity: 1,
                    },
                  ],
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
          container: getContainer(),
          shippingProfileOverride: distinctShippingProfile,
          inventoryItemOverride: distinctInventoryItem,
          productOverride: distinctProduct,
        })
      }

      it("filters orders by fulfillment_status and payment_status, excluding canceled orders", async () => {
        const readyToShipSeeder = await createDistinctOrderSeeder("ready")
        const readyToShipOrder = readyToShipSeeder.order

        await api.post(
          `/admin/payments/${readyToShipOrder.payment_collections[0].payments[0].id}/capture`,
          undefined,
          adminHeaders
        )

        const shippedSeeder = await createDistinctOrderSeeder("shipped")
        const shippedOrder = shippedSeeder.order

        await api.post(
          `/admin/payments/${shippedOrder.payment_collections[0].payments[0].id}/capture`,
          undefined,
          adminHeaders
        )

        const fulfilled = (
          await api.post(
            `/admin/orders/${shippedOrder.id}/fulfillments?fields=id,*fulfillments`,
            {
              shipping_option_id: shippedSeeder.shippingOption.id,
              location_id: shippedSeeder.stockLocation.id,
              items: shippedOrder.items.map((i) => ({
                id: i.id,
                quantity: i.quantity,
              })),
            },
            adminHeaders
          )
        ).data.order

        await api.post(
          `/admin/orders/${shippedOrder.id}/fulfillments/${fulfilled.fulfillments[0].id}/shipments`,
          {
            items: shippedOrder.items.map((i) => ({
              id: i.id,
              quantity: i.quantity,
            })),
          },
          adminHeaders
        )

        const canceledSeeder = await createDistinctOrderSeeder("canceled")
        const canceledOrder = canceledSeeder.order

        await api.post(
          `/admin/payments/${canceledOrder.payment_collections[0].payments[0].id}/capture`,
          undefined,
          adminHeaders
        )

        await api.post(
          `/admin/orders/${canceledOrder.id}/cancel`,
          {},
          adminHeaders
        )

        const response = await api.get(
          "/admin/orders?fulfillment_status[]=not_fulfilled&fulfillment_status[]=partially_fulfilled&payment_status[]=captured&payment_status[]=partially_captured",
          adminHeaders
        )

        const ids = response.data.orders.map((o) => o.id)
        expect(ids).toContain(readyToShipOrder.id)
        expect(ids).not.toContain(shippedOrder.id)
        expect(ids).not.toContain(canceledOrder.id)
      })

      it("returns the package and ship-from fields a Ready to Ship table needs, for an order matching the filter", async () => {
        const distinctShippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: `Test-ready-to-ship-fields`, type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        const distinctInventoryItem = (
          await api.post(
            `/admin/inventory-items`,
            { sku: `test-variant-ready-to-ship-fields` },
            adminHeaders
          )
        ).data.inventory_item

        const distinctProduct = (
          await api.post(
            "/admin/products",
            {
              title: `Test fixture ready-to-ship fields`,
              status: ProductStatus.PUBLISHED,
              shipping_profile_id: distinctShippingProfile.id,
              options: [
                { title: "size", values: ["large", "small"] },
                { title: "color", values: ["green"] },
              ],
              variants: [
                {
                  title: "Test variant",
                  sku: `test-variant-ready-to-ship-fields`,
                  weight: 12,
                  length: 4,
                  width: 5,
                  height: 6,
                  inventory_items: [
                    {
                      inventory_item_id: distinctInventoryItem.id,
                      required_quantity: 1,
                    },
                  ],
                  prices: [{ currency_code: "usd", amount: 100 }],
                  options: { size: "large", color: "green" },
                },
              ],
            },
            adminHeaders
          )
        ).data.product

        const fieldsSeeder = await createOrderSeeder({
          api,
          container: getContainer(),
          shippingProfileOverride: distinctShippingProfile,
          inventoryItemOverride: distinctInventoryItem,
          productOverride: distinctProduct,
        })
        const fieldsOrder = fieldsSeeder.order

        await api.post(
          `/admin/payments/${fieldsOrder.payment_collections[0].payments[0].id}/capture`,
          undefined,
          adminHeaders
        )

        const response = await api.get(
          "/admin/orders?fulfillment_status[]=not_fulfilled&fulfillment_status[]=partially_fulfilled&payment_status[]=captured&payment_status[]=partially_captured" +
            "&fields=id,*items.variant,+items.variant.weight,+items.variant.length,+items.variant.width,+items.variant.height,+items.detail.fulfilled_quantity,*shipping_methods,+shipping_methods.shipping_option.service_zone.fulfillment_set.location.name",
          adminHeaders
        )

        const result = response.data.orders.find(
          (o) => o.id === fieldsOrder.id
        )

        expect(result).toBeDefined()
        expect(result.items[0].variant).toMatchObject({
          weight: 12,
          length: 4,
          width: 5,
          height: 6,
        })
        expect(result.items[0].detail.fulfilled_quantity).toBe(0)
        expect(result.shipping_methods[0]).toMatchObject({
          name: expect.any(String),
          amount: expect.any(Number),
        })
        expect(
          result.shipping_methods[0].shipping_option.service_zone
            .fulfillment_set.location.name
        ).toBe(fieldsSeeder.stockLocation.name)
      })
    })
  },
})
