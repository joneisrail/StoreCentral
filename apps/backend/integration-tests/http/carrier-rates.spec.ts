import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { asFunction } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  adminHeaders,
  createAdminUser,
} from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    // Same container-key pattern documented in
    // apps/backend/integration-tests/http/bulk-fulfill-orders.spec.ts -- the
    // fulfillment module's provider loader registers this provider as
    // "fp_easypost_easypost", not "fp_easypost". Registering a stub under
    // that exact key intercepts quoteAllRates so this route's tests never
    // reach the real EasyPost API.
    const mockEasyPost = (overrides?: {
      quoteAllRates?: (...args: unknown[]) => Promise<unknown>
    }) => {
      const quoteAllRates =
        overrides?.quoteAllRates ??
        (async () => ({
          shipmentId: "shp_test",
          rates: [
            {
              carrier: "USPS",
              service: "Priority",
              name: "USPS Priority",
              rateId: "rate_cheap",
              amount: "5.00",
              currency: "USD",
            },
            {
              carrier: "UPS",
              service: "Ground",
              name: "UPS Ground",
              rateId: "rate_expensive",
              amount: "12.00",
              currency: "USD",
            },
          ],
        }))

      container.register(
        "fp_easypost_easypost",
        asFunction(() => ({ quoteAllRates }))
      )
    }

    describe("POST /admin/orders/:id/carrier-rates", () => {
      it("returns quoted rates sorted cheapest-first for a valid order/location/parcel", async () => {
        mockEasyPost()

        // createOrderSeeder's default stock location has no address, which
        // toEasyPostAddress rejects as an incomplete "origin" address -- this
        // test needs a stock location with a real, complete address instead.
        const stockLocation = (
          await api.post(
            `/admin/stock-locations`,
            {
              name: "carrier-rates test location",
              address: {
                address_1: "118 2nd street",
                city: "San Francisco",
                country_code: "us",
                province: "ca",
                postal_code: "94105",
              },
            },
            adminHeaders
          )
        ).data.stock_location

        const seeder = await createOrderSeeder({
          api,
          container,
          stockChannelOverride: stockLocation,
        })

        const response = await api.post(
          `/admin/orders/${seeder.order.id}/carrier-rates`,
          { location_id: seeder.stockLocation.id, parcel: { weight: 16 } },
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.shipment_id).toBe("shp_test")
        expect(response.data.rates.length).toBeGreaterThan(0)
        expect(response.data.rates[0]).toEqual({
          carrier: "USPS",
          service: "Priority",
          name: "USPS Priority",
          rate_id: "rate_cheap",
          amount: "5.00",
          currency: "USD",
        })
      })

      it("returns a 400 when the order's shipping address is incomplete", async () => {
        mockEasyPost()

        const seeder = await createOrderSeeder({ api, container })

        // There's no admin endpoint that lets an order's shipping address be
        // persisted with a required field missing (cart/order creation
        // always sends a complete one) -- so the incomplete address is
        // simulated directly at the DB layer, same
        // `PG_CONNECTION`-as-knex pattern fulfillment-queue.spec.ts uses.
        await container
          .resolve(ContainerRegistrationKeys.PG_CONNECTION)("order_address")
          .where({ id: seeder.order.shipping_address.id })
          .update({ postal_code: null })

        const response = await api
          .post(
            `/admin/orders/${seeder.order.id}/carrier-rates`,
            { location_id: seeder.stockLocation.id, parcel: { weight: 16 } },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
        expect(response.data.message).toMatch(/postal_code/)
      })
    })
  },
})
