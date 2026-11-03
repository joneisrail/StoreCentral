import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  adminHeaders,
  createAdminUser,
} from "../fixtures/create-admin-user"
import { installFakeEasyPost as installFake } from "../fixtures/fake-easypost"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

/**
 * End-to-end coverage for the admin bulk-fulfill flow through the REAL
 * EasyPost fulfillment provider service, the REAL Fulfillment Module and the
 * REAL createOrderFulfillmentWorkflow. Only `EasyPostClient` -- the thin
 * wrapper around the `@easypost/api` SDK -- is replaced, by the in-memory
 * fake in ../fixtures/fake-easypost.ts, which behaves like EasyPost does for
 * the calls this flow makes (most importantly: a second `buy` of an
 * already-purchased shipment is rejected, exactly like the real API's HTTP
 * 422 `SHIPMENT.POSTAGE.EXISTS`).
 *
 * Every other bulk-fulfill test mocks at the provider-service boundary, which
 * is how a fulfillment silently created under the checkout shipping option's
 * own provider (dropping the bought label), or a second label bought by the
 * EasyPost provider's own `createFulfillment`, went unnoticed. These tests
 * assert on the persisted fulfillment record itself.
 */

medusaIntegrationTestRunner({
  env: {
    // Never let an unstubbed call reach the real EasyPost API: a fake key
    // makes any such call fail loudly instead of buying a real label.
    EASYPOST_API_KEY: "EZTKtest_00000000000000000000000000000000",
  },
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let skuCounter = 0

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    const installFakeEasyPost = () => installFake(container)

    const createFulfillableOrder = async () => {
      const suffix = `ep-provider-${skuCounter++}-${Date.now()}`

      const inventoryItemOverride = (
        await api.post(
          `/admin/inventory-items`,
          { sku: `${suffix}-inventory` },
          adminHeaders
        )
      ).data.inventory_item

      const shippingProfileOverride = (
        await api.post(
          `/admin/shipping-profiles`,
          { name: `${suffix}-profile`, type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      const productOverride = (
        await api.post(
          "/admin/products",
          {
            title: `Test fixture ${suffix}`,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfileOverride.id,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title: "Test variant",
                sku: `${suffix}-variant`,
                inventory_items: [
                  {
                    inventory_item_id: inventoryItemOverride.id,
                    required_quantity: 1,
                  },
                ],
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "large" },
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

    const getFulfillments = async (orderId: string) => {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const {
        data: [order],
      } = await query.graph({
        entity: "order",
        filters: { id: orderId },
        fields: [
          "id",
          "fulfillments.id",
          "fulfillments.provider_id",
          "fulfillments.shipping_option_id",
          "fulfillments.data",
          "fulfillments.labels.*",
        ],
      })
      return order.fulfillments ?? []
    }

    describe("POST /admin/orders/fulfillments/batch through the real EasyPost provider", () => {
      it("records the admin-bought label on an EasyPost fulfillment for an order whose checkout shipping option uses the manual provider, buying exactly once", async () => {
        const fake = installFakeEasyPost()
        const seeder = await createFulfillableOrder()
        expect(seeder.shippingOption.provider_id).toBe("manual_manual")

        const quoted = fake.quote("shp_quote_manual")

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: seeder.order.id,
                location_id: seeder.stockLocation.id,
                shipment_id: quoted.id,
                rate_id: quoted.rates[0].id,
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.failed).toEqual([])
        expect(response.data.succeeded).toEqual([seeder.order.id])

        // Exactly one label bought for the whole flow - the admin's chosen
        // rate on the admin's quoted shipment.
        expect(fake.client.buyShipment).toHaveBeenCalledTimes(1)
        expect(fake.client.buyShipment).toHaveBeenCalledWith(
          quoted.id,
          quoted.rates[0].id
        )
        expect(fake.client.createShipment).not.toHaveBeenCalled()

        const fulfillments = await getFulfillments(seeder.order.id)
        expect(fulfillments).toHaveLength(1)
        const [fulfillment] = fulfillments

        expect(fulfillment.provider_id).toBe("easypost_easypost")
        // The order's own shipping option is still recorded unchanged.
        expect(fulfillment.shipping_option_id).toBe(seeder.shippingOption.id)
        expect(fulfillment.data.easypost_shipment_id).toBe(quoted.id)
        expect(fulfillment.data.easypost_rate_id).toBe(quoted.rates[0].id)
        expect(fulfillment.data.easypost_tracking_code).toBe(
          `EZ_TRACK_${quoted.id}`
        )
        expect(fulfillment.labels).toHaveLength(1)
        expect(fulfillment.labels[0].tracking_number).toBe(
          `EZ_TRACK_${quoted.id}`
        )
        expect(fulfillment.labels[0].label_url).toBe(
          `https://easypost.test/label/${quoted.id}.png`
        )
      })

      it("does not buy a second label when the order's checkout shipping option itself uses the EasyPost provider", async () => {
        const fake = installFakeEasyPost()
        const seeder = await createFulfillableOrder()

        // Turn the order's checkout shipping option into an EasyPost one,
        // with checkout-time EasyPost data on its shipping method (the shape
        // validateFulfillmentData persists), so the fulfillment would
        // otherwise be routed through EasyPost on the shipping option's own
        // provider - the double-buy path.
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
        await fulfillmentModule.updateShippingOptions(seeder.shippingOption.id, {
          provider_id: "easypost_easypost",
          data: {
            id: "USPS:GroundAdvantage",
            carrier: "USPS",
            service: "GroundAdvantage",
          },
        })
        const checkoutShipment = fake.quote("shp_checkout")
        const orderModule = container.resolve(Modules.ORDER)
        const shippingMethodId = seeder.order.shipping_methods[0].id
        await orderModule.updateOrderShippingMethods([
          {
            id: shippingMethodId,
            data: {
              easypost_shipment_id: checkoutShipment.id,
              easypost_rate_id: checkoutShipment.rates[0].id,
              easypost_carrier: "USPS",
              easypost_service: "GroundAdvantage",
            },
          },
        ])

        const quoted = fake.quote("shp_quote_easypost")

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: seeder.order.id,
                location_id: seeder.stockLocation.id,
                shipment_id: quoted.id,
                rate_id: quoted.rates[0].id,
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.failed).toEqual([])
        expect(response.data.succeeded).toEqual([seeder.order.id])

        expect(fake.client.buyShipment).toHaveBeenCalledTimes(1)
        expect(fake.client.buyShipment).toHaveBeenCalledWith(
          quoted.id,
          quoted.rates[0].id
        )
        expect(fake.client.createShipment).not.toHaveBeenCalled()
        // The checkout-time shipment is never bought by this flow.
        expect(fake.shipments.get(checkoutShipment.id)!.purchased).toBe(false)

        const [fulfillment] = await getFulfillments(seeder.order.id)
        expect(fulfillment.provider_id).toBe("easypost_easypost")
        expect(fulfillment.data.easypost_shipment_id).toBe(quoted.id)
        expect(fulfillment.data.easypost_tracking_code).toBe(
          `EZ_TRACK_${quoted.id}`
        )
        expect(fulfillment.labels[0].tracking_number).toBe(
          `EZ_TRACK_${quoted.id}`
        )
      })
    })
  },
})
