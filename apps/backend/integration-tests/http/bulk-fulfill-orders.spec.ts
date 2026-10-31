import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ProductStatus } from "@medusajs/framework/utils"
import { asFunction } from "@medusajs/framework/awilix"
import {
  adminHeaders,
  createAdminUser,
} from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let skuCounter = 0

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    // The step this route delegates to (bulkFulfillOrdersStep) resolves the
    // EasyPost provider service from the container as `container.resolve(
    // "fp_easypost_easypost")` -- the fulfillment module's provider loader
    // combines the provider class's static `identifier` ("easypost") with
    // the configured option `id` ("easypost") to build that key. Registering
    // a stub under that exact key here -- the same pattern this app's own
    // packages/core/core-flows/src/order/steps/__tests__/bulk-fulfill-orders.unit.spec.ts
    // uses -- intercepts every buyRate/createLabelBatch call so these HTTP
    // tests never reach the real EasyPost API.
    const mockEasyPost = (overrides?: {
      buyRate?: (shipmentId: string, rateId: string) => Promise<any>
      createLabelBatch?: (shipmentIds: string[], format: string) => Promise<any>
    }) => {
      const buyRate =
        overrides?.buyRate ??
        (async (shipmentId: string) => ({
          id: `bought_${shipmentId}`,
          trackingCode: `trk_${shipmentId}`,
          labelUrl: `https://easypost.test/label/${shipmentId}.pdf`,
        }))
      const createLabelBatch =
        overrides?.createLabelBatch ??
        (async () => ({ labelUrl: "https://easypost.test/batch.pdf" }))

      container.register(
        "fp_easypost_easypost",
        asFunction(() => ({ buyRate, createLabelBatch }))
      )
    }

    // `createOrderSeeder`'s default product/inventory-item creation uses
    // hardcoded skus ("test-variant" for both the inventory item and the
    // product variant) when no overrides are passed, so calling it more
    // than once in the same test (to get multiple independent orders)
    // needs its own product/inventory item with a unique sku each time, or
    // the second call 400s on the sku collision.
    const createFulfillableOrder = async () => {
      const suffix = `batch-fulfill-order-${skuCounter++}`

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
            options: [
              { title: "size", values: ["large", "small"] },
              { title: "color", values: ["green"] },
            ],
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

    describe("POST /admin/orders/fulfillments/batch", () => {
      it("fulfills each order with its chosen rate and returns a consolidated label url", async () => {
        mockEasyPost()

        const seeder = await createFulfillableOrder()
        const order = seeder.order

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: order.id,
                location_id: seeder.stockLocation.id,
                shipment_id: "shp_1",
                rate_id: "rate_1",
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.succeeded).toEqual([order.id])
        expect(response.data.failed).toEqual([])
        expect(response.data.label_pdf_url).toBeDefined()
      })

      it("rejects a request with the old order_ids shape", async () => {
        const response = await api
          .post(
            "/admin/orders/fulfillments/batch",
            { order_ids: ["order_123"] },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("rejects an empty fulfillments array", async () => {
        const response = await api
          .post(
            "/admin/orders/fulfillments/batch",
            { fulfillments: [] },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("rejects a fulfillment entry missing shipment_id/rate_id", async () => {
        const response = await api
          .post(
            "/admin/orders/fulfillments/batch",
            { fulfillments: [{ order_id: "order_123" }] },
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("fulfills each order independently, one order's failure doesn't block the others", async () => {
        mockEasyPost()

        const seederA = await createFulfillableOrder()
        const orderA = seederA.order

        const seederB = await createFulfillableOrder()
        const orderB = seederB.order

        // Remove orderB's stock reservation so createOrderFulfillmentWorkflow
        // throws a real validation error for it ("No stock reservation
        // found...") after the (mocked) EasyPost rate has already been
        // "bought" - this exercises the orphaned-purchase path where
        // easypost_shipment_id is reported on the failure entry.
        const orderBItemId = orderB.items[0].id
        const orderBReservations = (
          await api.get(
            `/admin/reservations?line_item_id[]=${orderBItemId}`,
            adminHeaders
          )
        ).data.reservations
        for (const reservation of orderBReservations) {
          await api.delete(
            `/admin/reservations/${reservation.id}`,
            adminHeaders
          )
        }

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: orderA.id,
                location_id: seederA.stockLocation.id,
                shipment_id: "shp_a",
                rate_id: "rate_a",
              },
              {
                order_id: orderB.id,
                location_id: seederB.stockLocation.id,
                shipment_id: "shp_b",
                rate_id: "rate_b",
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.succeeded).toEqual([orderA.id])
        expect(response.data.failed).toHaveLength(1)
        expect(response.data.failed[0].order_id).toEqual(orderB.id)
        expect(response.data.failed[0].error).toMatch(/stock reservation/i)
        // The EasyPost rate was already bought for orderB before the
        // fulfillment creation failed, so the orphaned purchase's shipment
        // id must round-trip all the way out through the HTTP response.
        expect(response.data.failed[0].easypost_shipment_id).toEqual(
          "bought_shp_b"
        )
        expect(response.data.label_pdf_url).toBeDefined()

        const afterA = (
          await api.get(
            `/admin/orders/${orderA.id}?fields=id,*fulfillments`,
            adminHeaders
          )
        ).data.order
        const afterB = (
          await api.get(
            `/admin/orders/${orderB.id}?fields=id,*fulfillments`,
            adminHeaders
          )
        ).data.order

        expect(afterA.fulfillments).toHaveLength(1)
        expect(afterB.fulfillments ?? []).toHaveLength(0)
      })

      it("only fulfills an order's own remaining unfulfilled items when it's already partially fulfilled, in a batch with a fresh order", async () => {
        mockEasyPost()

        // Build an order with two distinct line items so one can be
        // fulfilled ahead of time (simulating a previously-shipped item)
        // while the other is left unfulfilled for the batch call to pick
        // up - a mix of orders where one is already partially_fulfilled,
        // and the batch must only touch its own remaining items.
        const stockLocation = (
          await api.post(
            `/admin/stock-locations`,
            { name: "batch-fulfill test location" },
            adminHeaders
          )
        ).data.stock_location

        const shippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: `batch-fulfill-${stockLocation.id}`, type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        const inventoryItem1 = (
          await api.post(
            `/admin/inventory-items`,
            { sku: `batch-fulfill-1-${stockLocation.id}` },
            adminHeaders
          )
        ).data.inventory_item

        const inventoryItem2 = (
          await api.post(
            `/admin/inventory-items`,
            { sku: `batch-fulfill-2-${stockLocation.id}` },
            adminHeaders
          )
        ).data.inventory_item

        // `inventoryItem1` is passed to `createOrderSeeder` below as
        // `inventoryItemOverride`, which creates its own location-level for
        // it - only `inventoryItem2` (the `additionalProducts` item) needs
        // one created here, matching how the existing multi-product
        // fixture in order.spec.ts splits this responsibility.
        await api.post(
          `/admin/inventory-items/${inventoryItem2.id}/location-levels`,
          { location_id: stockLocation.id, stocked_quantity: 10 },
          adminHeaders
        )

        const product1 = (
          await api.post(
            "/admin/products",
            {
              title: `Batch fulfill product 1 ${stockLocation.id}`,
              status: ProductStatus.PUBLISHED,
              shipping_profile_id: shippingProfile.id,
              options: [{ title: "size", values: ["large"] }],
              variants: [
                {
                  title: "Variant 1",
                  sku: `batch-fulfill-variant-1-${stockLocation.id}`,
                  inventory_items: [
                    {
                      inventory_item_id: inventoryItem1.id,
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

        const product2 = (
          await api.post(
            "/admin/products",
            {
              title: `Batch fulfill product 2 ${stockLocation.id}`,
              status: ProductStatus.PUBLISHED,
              shipping_profile_id: shippingProfile.id,
              options: [{ title: "size", values: ["large"] }],
              variants: [
                {
                  title: "Variant 2",
                  sku: `batch-fulfill-variant-2-${stockLocation.id}`,
                  inventory_items: [
                    {
                      inventory_item_id: inventoryItem2.id,
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

        const seederC = await createOrderSeeder({
          api,
          container,
          productOverride: product1,
          additionalProducts: [
            { variant_id: product2.variants[0].id, quantity: 1 },
          ],
          stockChannelOverride: stockLocation,
          inventoryItemOverride: inventoryItem1,
          shippingProfileOverride: shippingProfile,
        })
        const orderC = seederC.order
        const item1 = orderC.items.find(
          (item) => item.variant_id === product1.variants[0].id
        )
        const item2 = orderC.items.find(
          (item) => item.variant_id === product2.variants[0].id
        )

        // Fulfill item1 only, ahead of the batch call, so the order is
        // already partially_fulfilled when the batch runs.
        await api.post(
          `/admin/orders/${orderC.id}/fulfillments`,
          {
            shipping_option_id: seederC.shippingOption.id,
            location_id: stockLocation.id,
            items: [{ id: item1.id, quantity: 1 }],
          },
          adminHeaders
        )

        // `fulfillment_status` is computed from each item's own
        // `quantity` versus `detail.fulfilled_quantity` - both need to be
        // in the requested fields for the computation to see them, not
        // just `*items.detail` on its own.
        const beforeBatch = (
          await api.get(
            `/admin/orders/${orderC.id}?fields=id,fulfillment_status,*items,*items.detail`,
            adminHeaders
          )
        ).data.order
        expect(beforeBatch.fulfillment_status).toEqual("partially_fulfilled")

        // A fresh, fully fulfillable order alongside the partially
        // fulfilled one, to confirm the batch handles a genuine mix.
        const seederD = await createFulfillableOrder()
        const orderD = seederD.order

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: orderC.id,
                location_id: stockLocation.id,
                shipment_id: "shp_c",
                rate_id: "rate_c",
              },
              {
                order_id: orderD.id,
                location_id: seederD.stockLocation.id,
                shipment_id: "shp_d",
                rate_id: "rate_d",
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.failed).toHaveLength(0)
        expect(response.data.succeeded).toEqual(
          expect.arrayContaining([orderC.id, orderD.id])
        )

        const afterC = (
          await api.get(
            `/admin/orders/${orderC.id}?fields=id,fulfillment_status,*items,*items.detail,*fulfillments.items`,
            adminHeaders
          )
        ).data.order

        expect(afterC.fulfillment_status).toEqual("fulfilled")

        const item1AfterBatch = afterC.items.find(
          (item) => item.id === item1.id
        )
        const item2AfterBatch = afterC.items.find(
          (item) => item.id === item2.id
        )
        expect(item1AfterBatch.detail.fulfilled_quantity).toEqual(1)
        expect(item2AfterBatch.detail.fulfilled_quantity).toEqual(1)

        // Exactly two fulfillments exist: the manual one for item1 and the
        // batch-created one for item2 - item1 was never re-fulfilled.
        expect(afterC.fulfillments).toHaveLength(2)
        const batchFulfillment = afterC.fulfillments.find(
          (fulfillment) =>
            !fulfillment.items.some((item) => item.line_item_id === item1.id)
        )
        expect(batchFulfillment).toBeDefined()
        expect(batchFulfillment.items).toHaveLength(1)
        expect(batchFulfillment.items[0].line_item_id).toEqual(item2.id)
      })
    })
  },
})
