import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ProductStatus } from "@medusajs/framework/utils"
import {
  adminHeaders,
  createAdminUser,
} from "../fixtures/create-admin-user"
import { installFakeEasyPost } from "../fixtures/fake-easypost"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

medusaIntegrationTestRunner({
  env: {
    // A fake key: any call that slips past the stubbed client fails loudly
    // instead of reaching the real EasyPost API.
    EASYPOST_API_KEY: "EZTKtest_00000000000000000000000000000000",
  },
  testSuite:({ dbConnection, getContainer, api }) => {
    let container
    let skuCounter = 0

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    // The step this route delegates to (bulkFulfillOrdersStep) reaches the
    // REAL EasyPost provider service through the Fulfillment Module, and the
    // fulfillment is then created through that same real provider. Only the
    // provider's `EasyPostClient` (the thin SDK wrapper) is swapped for an
    // in-memory fake (../fixtures/fake-easypost.ts), so these HTTP tests
    // never reach the real EasyPost API. Each test registers the shipments
    // it "quoted" with `fake.quote(id)` before fulfilling with them.
    const mockEasyPost = () => installFakeEasyPost(container)

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
        const fake = mockEasyPost()
        fake.quote("shp_1")

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
        expect(response.data.label_pdf_url).toMatch(/\.pdf$/)
        expect(fake.client.createBatch).toHaveBeenCalledWith(["shp_1"])
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

      it("fulfills each order independently, and never buys a label for an order that would predictably fail to fulfill", async () => {
        const fake = mockEasyPost()
        fake.quote("shp_a")
        fake.quote("shp_b")

        const seederA = await createFulfillableOrder()
        const orderA = seederA.order

        const seederB = await createFulfillableOrder()
        const orderB = seederB.order

        // Remove orderB's stock reservation: createOrderFulfillmentWorkflow
        // would reject it ("No stock reservation found..."), and the
        // pre-buy validation must catch that BEFORE any money is spent.
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
        // Nothing was bought for orderB.
        expect(response.data.failed[0].easypost_shipment_id).toBeUndefined()
        expect(fake.client.buyShipment).toHaveBeenCalledTimes(1)
        expect(fake.client.buyShipment).toHaveBeenCalledWith("shp_a", "rate_a")
        expect(fake.shipments.get("shp_b")!.purchased).toBe(false)
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

      it("fails a held order without buying a label and still fulfills the rest of the batch", async () => {
        const fake = mockEasyPost()
        fake.quote("shp_ok")
        fake.quote("shp_held")

        const seederOk = await createFulfillableOrder()
        const seederHeld = await createFulfillableOrder()

        const hold = await api.post(
          `/admin/orders/${seederHeld.order.id}/hold`,
          { reason: "Check address" },
          adminHeaders
        )
        expect(hold.status).toEqual(200)

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: seederHeld.order.id,
                location_id: seederHeld.stockLocation.id,
                shipment_id: "shp_held",
                rate_id: "rate_held",
              },
              {
                order_id: seederOk.order.id,
                location_id: seederOk.stockLocation.id,
                shipment_id: "shp_ok",
                rate_id: "rate_ok",
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.succeeded).toEqual([seederOk.order.id])
        expect(response.data.failed).toHaveLength(1)
        expect(response.data.failed[0].order_id).toEqual(seederHeld.order.id)
        expect(response.data.failed[0].error).toMatch(/on hold/i)
        expect(response.data.failed[0].easypost_shipment_id).toBeUndefined()
        expect(fake.client.buyShipment).toHaveBeenCalledTimes(1)
        expect(fake.shipments.get("shp_held")!.purchased).toBe(false)
      })

      it("never buys a label when the chosen Ship From location doesn't stock the order's items", async () => {
        const fake = mockEasyPost()
        fake.quote("shp_unstocked")

        const seeder = await createFulfillableOrder()
        const elsewhere = (
          await api.post(
            `/admin/stock-locations`,
            { name: "location that stocks nothing" },
            adminHeaders
          )
        ).data.stock_location

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: seeder.order.id,
                location_id: elsewhere.id,
                shipment_id: "shp_unstocked",
                rate_id: "rate_unstocked",
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.succeeded).toEqual([])
        expect(response.data.failed).toEqual([
          {
            order_id: seeder.order.id,
            error: expect.stringMatching(
              new RegExp(`${elsewhere.id} doesn't stock`)
            ),
          },
        ])
        expect(fake.client.buyShipment).not.toHaveBeenCalled()
        expect(fake.client.createBatch).not.toHaveBeenCalled()
        expect(response.data.label_pdf_url).toBeUndefined()
      })

      it("reports the bought shipment id when fulfillment creation fails after the label was bought, and leaves that label out of the printable batch", async () => {
        const fake = mockEasyPost()
        fake.quote("shp_ok")
        fake.quote("shp_orphan")

        // The EasyPost provider's createFulfillment verifies the bought
        // shipment with EasyPost before recording it; make that read fail
        // for one order only, AFTER its label was bought.
        const realRetrieve = fake.client.retrieveShipment.getMockImplementation()!
        fake.client.retrieveShipment.mockImplementation(async (id: string) => {
          if (id === "shp_orphan") {
            throw new Error("EasyPost is unreachable")
          }
          return realRetrieve(id)
        })

        const seederOk = await createFulfillableOrder()
        const seederOrphan = await createFulfillableOrder()

        const response = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: seederOk.order.id,
                location_id: seederOk.stockLocation.id,
                shipment_id: "shp_ok",
                rate_id: "rate_ok",
              },
              {
                order_id: seederOrphan.order.id,
                location_id: seederOrphan.stockLocation.id,
                shipment_id: "shp_orphan",
                rate_id: "rate_orphan",
              },
            ],
          },
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.succeeded).toEqual([seederOk.order.id])
        expect(response.data.failed).toEqual([
          {
            order_id: seederOrphan.order.id,
            error: expect.stringMatching(/EasyPost is unreachable/),
            // The orphaned purchase's shipment id round-trips all the way
            // out through the HTTP response.
            easypost_shipment_id: "shp_orphan",
          },
        ])
        expect(fake.shipments.get("shp_orphan")!.purchased).toBe(true)

        // Only the fulfilled order's label is printable.
        expect(fake.client.createBatch).toHaveBeenCalledTimes(1)
        expect(fake.client.createBatch).toHaveBeenCalledWith(["shp_ok"])
        expect(response.data.label_pdf_url).toBeDefined()

        const afterOrphan = (
          await api.get(
            `/admin/orders/${seederOrphan.order.id}?fields=id,*fulfillments`,
            adminHeaders
          )
        ).data.order
        expect(afterOrphan.fulfillments ?? []).toHaveLength(0)
      })

      it("only fulfills an order's own remaining unfulfilled items when it's already partially fulfilled, in a batch with a fresh order", async () => {
        const fake = mockEasyPost()
        fake.quote("shp_c")
        fake.quote("shp_d")

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
