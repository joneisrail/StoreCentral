import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { installFakeEasyPost } from "../fixtures/fake-easypost"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

// Spike findings encoded here: createOrderFulfillmentWorkflow +
// createOrderShipmentWorkflow work for an order with no EasyPost label when the
// fulfillment is created through the system manual provider (`manual_manual`).
// A draft-order import (the seller-hub path) has NO shipping method, and core
// then fails with "Cannot read properties of undefined (reading 'provider_id')"
// unless a shipping option is passed, so the workflow supplies a manual one.
medusaIntegrationTestRunner({
  env: {
    EASYPOST_API_KEY: "EZTKtest_00000000000000000000000000000000",
  },
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let counter = 0

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
    })

    const createFulfillableOrder = async () => {
      const suffix = `mark-shipped-${counter++}`
      const inventoryItem = (await api.post(`/admin/inventory-items`, { sku: `${suffix}-inventory` }, adminHeaders)).data
        .inventory_item
      const shippingProfile = (
        await api.post(`/admin/shipping-profiles`, { name: `${suffix}-profile`, type: "default" }, adminHeaders)
      ).data.shipping_profile
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Test fixture ${suffix}`,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfile.id,
            options: [
              { title: "size", values: ["large", "small"] },
              { title: "color", values: ["green"] },
            ],
            variants: [
              {
                title: "Test variant",
                sku: `${suffix}-variant`,
                inventory_items: [{ inventory_item_id: inventoryItem.id, required_quantity: 1 }],
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
        productOverride: product,
        inventoryItemOverride: inventoryItem,
        shippingProfileOverride: shippingProfile,
      })
    }

    const getOrder = async (id: string) =>
      (
        await api.get(
          `/admin/orders/${id}?fields=id,fulfillment_status,metadata,*fulfillments,*fulfillments.labels,*items,*items.detail,*tags`,
          adminHeaders
        )
      ).data.order

    const markShipped = (id: string, body: any = {}) =>
      api
        .post(`/admin/orders/${id}/mark-shipped`, { carrier: "UPS", tracking_number: "1Z999AA1", ...body }, adminHeaders)
        .catch((e) => e.response)

    describe("POST /admin/orders/:id/mark-shipped", () => {
      it("ships an order that has a manual shipping method with the user's own tracking", async () => {
        const seeder = await createFulfillableOrder()
        const eventBus = container.resolve(Modules.EVENT_BUS)
        const emitSpy = jest.spyOn(eventBus, "emit")

        const res = await markShipped(seeder.order.id, {
          tracking_url: "https://track.example/1Z999AA1",
          shipped_at: "2026-02-02T10:00:00.000Z",
          no_notification: true,
        })
        expect(res.status).toBe(200)
        expect(res.data.order_id).toBe(seeder.order.id)

        const after = await getOrder(seeder.order.id)
        expect(after.fulfillment_status).toBe("shipped")
        expect(after.fulfillments).toHaveLength(1)
        const fulfillment = after.fulfillments[0]
        expect(fulfillment.id).toBe(res.data.fulfillment_id)
        expect(fulfillment.shipped_at).toBeTruthy()
        expect(fulfillment.canceled_at).toBeFalsy()
        expect(fulfillment.metadata).toEqual({ carrier: "UPS", shipped_at: "2026-02-02T10:00:00.000Z" })
        expect(fulfillment.data?.carrier).toBe("UPS")
        expect(fulfillment.labels).toEqual([
          expect.objectContaining({
            tracking_number: "1Z999AA1",
            tracking_url: "https://track.example/1Z999AA1",
          }),
        ])
        expect(after.items.every((i) => i.detail.fulfilled_quantity === i.quantity)).toBe(true)

        const events = emitSpy.mock.calls.map((c: any[]) => (Array.isArray(c[0]) ? c[0] : [c[0]])).flat() as any[]
        expect(events).toContainEqual(
          expect.objectContaining({
            name: "shipment.created",
            data: { id: fulfillment.id, no_notification: true },
          })
        )
        emitSpy.mockRestore()

        const again = await markShipped(seeder.order.id)
        expect(again.status).toBe(400)
      })

      it("ships an imported order that has no shipping method through the manual provider", async () => {
        const seeder = await createFulfillableOrder()
        // Mimics a seller-hub import: a draft order converted to an order with
        // custom items and no shipping method or reservations.
        const draft = (
          await api.post(
            "/admin/draft-orders",
            {
              email: "import@example.com",
              region_id: seeder.region.id,
              currency_code: "usd",
              shipping_address: {
                first_name: "Imp",
                last_name: "Orter",
                address_1: "1 Main",
                city: "ny",
                country_code: "us",
                postal_code: "94016",
              },
            },
            adminHeaders
          )
        ).data.draft_order
        await api.post(`/admin/draft-orders/${draft.id}/edit`, {}, adminHeaders)
        await api.post(
          `/admin/draft-orders/${draft.id}/edit/items`,
          { items: [{ title: "Imported item", unit_price: 10, quantity: 2 }] },
          adminHeaders
        )
        await api.post(`/admin/draft-orders/${draft.id}/edit/confirm`, {}, adminHeaders)
        await api.post(`/admin/draft-orders/${draft.id}/convert-to-order`, {}, adminHeaders)
        const before = await getOrder(draft.id)
        expect(before.fulfillments).toHaveLength(0)

        const res = await markShipped(draft.id, { location_id: seeder.stockLocation.id })
        expect(res.status).toBe(200)

        const after = await getOrder(draft.id)
        expect(after.fulfillment_status).toBe("shipped")
        expect(after.fulfillments[0].labels[0].tracking_number).toBe("1Z999AA1")
        expect(after.fulfillments[0].labels[0].tracking_url).toBe("")
      })

      it("rejects held, canceled, shipped and label-holding orders, and an unknown order", async () => {
        const fake = installFakeEasyPost(container)

        const held = await createFulfillableOrder()
        await api.post(`/admin/orders/${held.order.id}/hold`, { reason: "Check" }, adminHeaders)
        const heldRes = await markShipped(held.order.id)
        expect(heldRes.status).toBe(400)
        expect(heldRes.data.message).toMatch(/on hold/)

        const canceled = await createFulfillableOrder()
        await api.post(`/admin/orders/${canceled.order.id}/cancel`, {}, adminHeaders)
        expect((await markShipped(canceled.order.id)).status).toBe(400)

        const shipped = await createFulfillableOrder()
        expect((await markShipped(shipped.order.id)).status).toBe(200)
        expect((await markShipped(shipped.order.id)).status).toBe(400)

        const labeled = await createFulfillableOrder()
        fake.quote("shp_ms_1")
        const bought = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: labeled.order.id,
                location_id: labeled.stockLocation.id,
                shipment_id: "shp_ms_1",
                rate_id: "rate_1",
              },
            ],
          },
          adminHeaders
        )
        expect(bought.data.succeeded).toEqual([labeled.order.id])
        const labeledRes = await markShipped(labeled.order.id)
        expect(labeledRes.status).toBe(400)
        expect(labeledRes.data.message).toMatch(/Void the shipping label first/)

        const missing = await markShipped("order_missing")
        expect(missing.status).toBe(404)
      })

      it("ships an order whose own shipping option is EasyPost-backed without buying a label", async () => {
        const fake = installFakeEasyPost(container)
        const seeder = await createFulfillableOrder()
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
        await fulfillmentModule.updateShippingOptions(seeder.shippingOption.id, {
          provider_id: "easypost_easypost",
          data: { id: "USPS:GroundAdvantage", carrier: "USPS", service: "GroundAdvantage" },
        })
        const checkoutShipment = fake.quote("shp_checkout_ms")
        const orderModule = container.resolve(Modules.ORDER)
        await orderModule.updateOrderShippingMethods([
          {
            id: seeder.order.shipping_methods[0].id,
            data: {
              easypost_shipment_id: checkoutShipment.id,
              easypost_rate_id: checkoutShipment.rates[0].id,
              easypost_carrier: "USPS",
              easypost_service: "GroundAdvantage",
            },
          },
        ])
        const eventBus = container.resolve(Modules.EVENT_BUS)
        const emitSpy = jest.spyOn(eventBus, "emit")

        const res = await markShipped(seeder.order.id, { carrier: "DHL", tracking_number: "DHL123" })
        expect(res.status).toBe(200)

        const after = (
          await api.get(
            `/admin/orders/${seeder.order.id}?fields=id,fulfillment_status,*fulfillments,*fulfillments.labels`,
            adminHeaders
          )
        ).data.order
        expect(after.fulfillment_status).toBe("shipped")
        const fulfillment = after.fulfillments[0]
        expect(fulfillment.provider_id).toBe("manual_manual")
        expect(fulfillment.data.carrier).toBe("DHL")
        expect(fulfillment.metadata.carrier).toBe("DHL")
        expect(fulfillment.data.easypost_shipment_id).toBeUndefined()
        expect(fulfillment.labels[0].tracking_number).toBe("DHL123")
        const events = emitSpy.mock.calls.map((c: any[]) => (Array.isArray(c[0]) ? c[0] : [c[0]])).flat() as any[]
        expect(events).toContainEqual(expect.objectContaining({ name: "shipment.created" }))
        emitSpy.mockRestore()

        expect(fake.client.buyShipment).not.toHaveBeenCalled()
        expect(fake.client.createShipment).not.toHaveBeenCalled()
        expect(fake.client.refundShipment).not.toHaveBeenCalled()
        expect(fake.shipments.get(checkoutShipment.id)!.purchased).toBe(false)
      })

      it("matches the manual option to the items' shipping profile when the order has no shipping method", async () => {
        const seeder = await createFulfillableOrder()
        const orderModule = container.resolve(Modules.ORDER)
        await orderModule.deleteOrderShippingMethods(seeder.order.shipping_methods.map((m) => m.id))

        // The only manual option is for a different profile than the item's.
        const otherProfile = (
          await api.post(`/admin/shipping-profiles`, { name: `other-profile-${counter++}`, type: "default" }, adminHeaders)
        ).data.shipping_profile
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
        await fulfillmentModule.updateShippingOptions(seeder.shippingOption.id, {
          shipping_profile_id: otherProfile.id,
        })
        const rejected = await markShipped(seeder.order.id)
        expect(rejected.status).toBe(400)
        expect(rejected.data.message).toMatch(/No manual shipping option matches this order's shipping profile/)

        await fulfillmentModule.updateShippingOptions(seeder.shippingOption.id, {
          shipping_profile_id: seeder.shippingProfile.id,
        })
        const ok = await markShipped(seeder.order.id)
        expect(ok.status).toBe(200)
        expect((await getOrder(seeder.order.id)).fulfillment_status).toBe("shipped")
      })

      it("lets exactly one of two concurrent calls for the same order succeed", async () => {
        const seeder = await createFulfillableOrder()
        const results = await Promise.all([markShipped(seeder.order.id), markShipped(seeder.order.id)])
        const statuses = results.map((r) => r.status).sort()
        expect(statuses.filter((s) => s === 200)).toHaveLength(1)
        expect(statuses.filter((s) => s !== 200)).toHaveLength(1)
        const failed = results.find((r) => r.status !== 200)
        expect(failed.status).toBe(409)
        expect(failed.data.message).toMatch(/conflicted with another request/)
        expect((await getOrder(seeder.order.id)).fulfillments.filter((f) => !f.canceled_at)).toHaveLength(1)
      })

      it("validates the body", async () => {
        const seeder = await createFulfillableOrder()
        expect((await markShipped(seeder.order.id, { tracking_number: "" })).status).toBe(400)
        expect((await markShipped(seeder.order.id, { tracking_url: "nope" })).status).toBe(400)
        expect((await markShipped(seeder.order.id, { extra: 1 })).status).toBe(400)
      })
    })
  },
})
