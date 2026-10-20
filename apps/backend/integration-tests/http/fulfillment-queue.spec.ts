import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  createOrderWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(120000)

const adminHeaders = { headers: { authorization: "" } }

type Status =
  | "not_fulfilled"
  | "partially_fulfilled"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "canceled"

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer, dbConnection }) => {
    describe("GET /admin/fulfillment-queue", () => {
      let regionId: string
      let locationId: string
      let shippingOptionId: string
      let storefrontChannelId: string
      let amazonChannelId: string

      beforeAll(async () => {
        const container = getContainer()
        await createAdminUser(container, adminHeaders)

        const { result: regions } = await createRegionsWorkflow(container).run({
          input: {
            regions: [
              { name: "Test Region", currency_code: "usd", countries: ["us"] },
            ],
          },
        })
        regionId = regions[0].id

        const { result: locations } = await createStockLocationsWorkflow(
          container
        ).run({
          input: { locations: [{ name: "Test Warehouse" }] },
        })
        locationId = locations[0].id

        const { result: channels } = await createSalesChannelsWorkflow(
          container
        ).run({
          input: {
            salesChannelsData: [{ name: "Storefront" }, { name: "Amazon" }],
          },
        })
        storefrontChannelId = channels[0].id
        amazonChannelId = channels[1].id

        // createOrderFulfillmentWorkflow (used by POST /admin/orders/:id/fulfillments)
        // resolves its provider via a real shipping_option -- it cannot create a
        // fulfillment from a bare location_id alone. Build the minimal real chain
        // (fulfillment set -> service zone -> shipping option, linked to the stock
        // location) the same way core's own
        // integration-tests/modules/__tests__/order/workflows/create-fulfillment.spec.ts
        // does, using the "manual_manual" provider this app already registers by
        // default (no extra provider registration needed).
        const fulfillmentService = container.resolve(Modules.FULFILLMENT)
        const shippingProfile = await fulfillmentService.createShippingProfiles(
          {
            name: "Test Shipping Profile",
            type: "default",
          }
        )
        const fulfillmentSet = await fulfillmentService.createFulfillmentSets({
          name: "Test Fulfillment Set",
          type: "shipping",
        })
        const serviceZone = await fulfillmentService.createServiceZones({
          name: "Test Service Zone",
          fulfillment_set_id: fulfillmentSet.id,
          geo_zones: [{ type: "country", country_code: "us" }],
        })

        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
        await remoteLink.create([
          {
            [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
            [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
          },
          {
            [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
            [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
          },
        ])

        const { result: shippingOptions } = await createShippingOptionsWorkflow(
          container
        ).run({
          input: [
            {
              name: "Test Shipping Option",
              price_type: "flat",
              service_zone_id: serviceZone.id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_manual",
              type: {
                code: "test-shipping",
                label: "Test Shipping",
                description: "Test shipping option",
              },
              prices: [{ currency_code: "usd", amount: 10 }],
            },
          ],
        })
        shippingOptionId = shippingOptions[0].id
      })

      const createOrderInStatus = async (
        status: Status,
        opts: { salesChannelId: string; createdAt?: string }
      ) => {
        const container = getContainer()
        const quantity = status === "partially_fulfilled" ? 2 : 1

        const { result: order } = await createOrderWorkflow(container).run({
          input: {
            region_id: regionId,
            sales_channel_id: opts.salesChannelId,
            email: "buyer@example.com",
            currency_code: "usd",
            items: [
              {
                title: "Test Item",
                quantity,
                unit_price: 10,
              },
            ],
          },
        })

        if (opts.createdAt) {
          await getContainer()
            .resolve(ContainerRegistrationKeys.PG_CONNECTION)("order")
            .where({ id: order.id })
            .update({ created_at: opts.createdAt })
        }

        if (status === "not_fulfilled") {
          return order
        }

        const detail = await api.get(
          `/admin/orders/${order.id}?fields=id,*items`,
          adminHeaders
        )
        const lineItemId = detail.data.order.items[0].id
        const fulfillQuantity = status === "partially_fulfilled" ? 1 : quantity

        const fulfillment = await api.post(
          `/admin/orders/${order.id}/fulfillments?fields=id,*fulfillments`,
          {
            items: [{ id: lineItemId, quantity: fulfillQuantity }],
            location_id: locationId,
            shipping_option_id: shippingOptionId,
          },
          adminHeaders
        )
        const fulfillmentId = fulfillment.data.order.fulfillments[0].id

        if (status === "fulfilled" || status === "partially_fulfilled") {
          return order
        }

        if (status === "shipped" || status === "delivered") {
          await api.post(
            `/admin/orders/${order.id}/fulfillments/${fulfillmentId}/shipments`,
            { items: [{ id: lineItemId, quantity: fulfillQuantity }] },
            adminHeaders
          )
        }

        if (status === "delivered") {
          await api.post(
            `/admin/orders/${order.id}/fulfillments/${fulfillmentId}/mark-as-delivered`,
            {},
            adminHeaders
          )
        }

        if (status === "canceled") {
          await api.post(
            `/admin/orders/${order.id}/fulfillments/${fulfillmentId}/cancel`,
            {},
            adminHeaders
          )
        }

        return order
      }

      it("returns orders with a real unfulfilled item, excludes orders with none, oldest first, with channel names", async () => {
        const notFulfilled = await createOrderInStatus("not_fulfilled", {
          salesChannelId: storefrontChannelId,
          createdAt: new Date(
            Date.now() - 2 * 24 * 60 * 60 * 1000
          ).toISOString(),
        })
        const partiallyFulfilled = await createOrderInStatus(
          "partially_fulfilled",
          {
            salesChannelId: amazonChannelId,
            createdAt: new Date(
              Date.now() - 1 * 24 * 60 * 60 * 1000
            ).toISOString(),
          }
        )
        await createOrderInStatus("fulfilled", {
          salesChannelId: storefrontChannelId,
        })
        await createOrderInStatus("shipped", {
          salesChannelId: storefrontChannelId,
        })
        await createOrderInStatus("delivered", {
          salesChannelId: storefrontChannelId,
        })
        // Canceling a FULFILLMENT (not the order) really does roll the
        // item's fulfilled_quantity back down (confirmed by reading the
        // real CANCEL_ITEM_FULFILLMENT change-action handler in
        // packages/modules/order/src/utils/actions/cancel-item-fulfillment.ts,
        // which subtracts the canceled quantity) -- so this order
        // genuinely needs fulfilling again and must now appear, unlike
        // under the first (Critical-finding) implementation that
        // excluded anything core labeled "canceled".
        const fulfillmentCanceled = await createOrderInStatus("canceled", {
          salesChannelId: storefrontChannelId,
        })

        const res = await api.get("/admin/fulfillment-queue", adminHeaders)

        const ids = res.data.orders.map((o: any) => o.id)
        expect(ids).toEqual([
          notFulfilled.id,
          partiallyFulfilled.id,
          fulfillmentCanceled.id,
        ])
        expect(res.data.orders[0].sales_channel.name).toBe("Storefront")
        expect(res.data.orders[1].sales_channel.name).toBe("Amazon")
      })

      it("excludes an order that was itself canceled with zero fulfillments (Critical finding #1: getLastFulfillmentStatus never looks at order.status)", async () => {
        const canceledOrder = await createOrderInStatus("not_fulfilled", {
          salesChannelId: storefrontChannelId,
        })
        await api.post(
          `/admin/orders/${canceledOrder.id}/cancel`,
          {},
          adminHeaders
        )

        const stillUnfulfilled = await createOrderInStatus("not_fulfilled", {
          salesChannelId: storefrontChannelId,
        })

        const res = await api.get(
          "/admin/fulfillment-queue?limit=100",
          adminHeaders
        )

        const ids = res.data.orders.map((o: any) => o.id)
        expect(ids).toContain(stillUnfulfilled.id)
        expect(ids).not.toContain(canceledOrder.id)
      })

      it("includes a partially_shipped order with one real unit still unfulfilled (Critical finding #2: a fulfillment_status allow-list excludes partially_shipped/partially_delivered even though real items still need fulfilling)", async () => {
        const container = getContainer()
        const { result: order } = await createOrderWorkflow(container).run({
          input: {
            region_id: regionId,
            sales_channel_id: storefrontChannelId,
            email: "buyer@example.com",
            currency_code: "usd",
            items: [
              {
                title: "Split Item",
                quantity: 2,
                unit_price: 10,
                requires_shipping: true,
              },
            ],
          },
        })

        const detail = await api.get(
          `/admin/orders/${order.id}?fields=id,*items`,
          adminHeaders
        )
        const lineItemId = detail.data.order.items[0].id

        // Fulfill and ship only 1 of the 2 ordered units -- the other
        // unit is never fulfilled at all.
        const fulfillment = await api.post(
          `/admin/orders/${order.id}/fulfillments?fields=id,*fulfillments`,
          {
            items: [{ id: lineItemId, quantity: 1 }],
            location_id: locationId,
            shipping_option_id: shippingOptionId,
          },
          adminHeaders
        )
        const fulfillmentId = fulfillment.data.order.fulfillments[0].id
        await api.post(
          `/admin/orders/${order.id}/fulfillments/${fulfillmentId}/shipments`,
          { items: [{ id: lineItemId, quantity: 1 }] },
          adminHeaders
        )

        // Confirm the real item state this test depends on: 1 of 2
        // units fulfilled, a genuine unfulfilled unit remains. (Not
        // asserting the order's exact fulfillment_status label here --
        // the single-order GET route uses a different workflow,
        // getOrderDetailWorkflow, than the list route this plan's own
        // route.ts calls, getOrdersListWorkflow, and the two were
        // observed to disagree for this exact scenario during review
        // -- the list workflow is the one this feature actually
        // depends on, exercised directly below via the real route.)
        const itemCheck = await api.get(
          `/admin/orders/${order.id}?fields=id,*items`,
          adminHeaders
        )
        expect(itemCheck.data.order.items[0].detail.fulfilled_quantity).toBe(1)
        expect(itemCheck.data.order.items[0].quantity).toBe(2)

        const res = await api.get(
          "/admin/fulfillment-queue?limit=100",
          adminHeaders
        )
        const ids = res.data.orders.map((o: any) => o.id)
        expect(ids).toContain(order.id)
      })

      it("excludes a draft order even if unfulfilled", async () => {
        const container = getContainer()
        const { result: draftOrder } = await createOrderWorkflow(container).run(
          {
            input: {
              region_id: regionId,
              sales_channel_id: storefrontChannelId,
              email: "buyer@example.com",
              currency_code: "usd",
              items: [{ title: "Draft Item", quantity: 1, unit_price: 10 }],
            },
          }
        )

        // CreateOrderWorkflowInput (this installed @medusajs/medusa version)
        // doesn't accept is_draft_order at creation -- only
        // UpdateOrderDTO does. Flip it via the module service directly.
        const orderModule = container.resolve(Modules.ORDER)
        await orderModule.updateOrders(draftOrder.id, { is_draft_order: true })

        const realOrder = await createOrderInStatus("not_fulfilled", {
          salesChannelId: storefrontChannelId,
        })

        const res = await api.get(
          "/admin/fulfillment-queue?limit=100",
          adminHeaders
        )

        const ids = res.data.orders.map((o: any) => o.id)
        expect(ids).toContain(realOrder.id)
        expect(ids).not.toContain(draftOrder.id)
      })

      it("excludes an order older than the 90-day window", async () => {
        const oldDate = new Date()
        oldDate.setDate(oldDate.getDate() - 100)

        const oldOrder = await createOrderInStatus("not_fulfilled", {
          salesChannelId: storefrontChannelId,
          createdAt: oldDate.toISOString(),
        })
        const recentOrder = await createOrderInStatus("not_fulfilled", {
          salesChannelId: storefrontChannelId,
        })

        const res = await api.get(
          "/admin/fulfillment-queue?limit=100",
          adminHeaders
        )

        const ids = res.data.orders.map((o: any) => o.id)
        expect(ids).toContain(recentOrder.id)
        expect(ids).not.toContain(oldOrder.id)
      })

      it("paginates the filtered count, not the fetched window size", async () => {
        // medusaIntegrationTestRunner restores a clean DB snapshot
        // before each test, so these are the only orders in the
        // window -- an exact count is safe to assert, and mixing in
        // fulfilled (excluded) orders proves count reflects the
        // filtered set, not every order in the 90-day window.
        const base = Date.now() - 3 * 60 * 60 * 1000
        for (let i = 0; i < 3; i++) {
          const createdAt = new Date(base + i * 1000).toISOString()
          await createOrderInStatus("not_fulfilled", {
            salesChannelId: storefrontChannelId,
            createdAt,
          })
        }
        await createOrderInStatus("fulfilled", {
          salesChannelId: storefrontChannelId,
        })
        await createOrderInStatus("shipped", {
          salesChannelId: storefrontChannelId,
        })

        const res = await api.get(
          "/admin/fulfillment-queue?offset=0&limit=2",
          adminHeaders
        )

        expect(res.data.orders).toHaveLength(2)
        expect(res.data.count).toBe(3)
      })
    })
  },
})
