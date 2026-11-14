import crypto from "crypto"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { installFakeEasyPost } from "../fixtures/fake-easypost"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

const WEBHOOK_SECRET = "test-easypost-webhook-secret"

const signRawBody = (rawBody: string) =>
  `hmac-sha256-hex=${crypto
    .createHmac("sha256", Buffer.from(WEBHOOK_SECRET.normalize("NFKD"), "utf8"))
    .update(Buffer.from(rawBody, "utf8"))
    .digest("hex")}`

medusaIntegrationTestRunner({
  env: {
    EASYPOST_API_KEY: "EZTKtest_00000000000000000000000000000000",
    EASYPOST_WEBHOOK_SECRET: WEBHOOK_SECRET,
  },
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let counter = 0
    let adminUserId: string

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
      const [user] = await container.resolve(Modules.USER).listUsers({})
      adminUserId = user.id
    })

    const createFulfillableOrder = async () => {
      const suffix = `order-events-${counter++}`
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

    const getEvents = async (orderId: string) =>
      (await api.get(`/admin/orders/${orderId}/events`, adminHeaders)).data.events as any[]

    describe("GET /admin/orders/:id/events", () => {
      it("requires authentication and 404s for an unknown order", async () => {
        const seeder = await createFulfillableOrder()
        const anon = await api.get(`/admin/orders/${seeder.order.id}/events`).catch((e) => e.response)
        expect(anon.status).toBe(401)
        const missing = await api.get(`/admin/orders/order_missing/events`, adminHeaders).catch((e) => e.response)
        expect(missing.status).toBe(404)
        expect(await getEvents(seeder.order.id)).toEqual([])
      })

      it("records hold and release with the reason and the admin user as actor, newest first", async () => {
        const { order } = await createFulfillableOrder()
        await api.post(`/admin/orders/${order.id}/hold`, { reason: "Check address" }, adminHeaders)
        await api.post(`/admin/orders/${order.id}/release`, {}, adminHeaders)

        const events = await getEvents(order.id)
        expect(events.map((e) => e.type)).toEqual(["order.released", "order.held"])
        const [released, held] = events
        expect(held.new_value).toEqual({ reason: "Check address" })
        expect(held.actor).toEqual({ id: adminUserId, name: expect.any(String) })
        expect(released.old_value).toEqual({ reason: "Check address" })
        expect(released.actor.id).toBe(adminUserId)
        expect(held.created_at).toBeTruthy()
      })

      it("records a voided label", async () => {
        const fake = installFakeEasyPost(container)
        fake.quote("shp_events_void")
        const seeder = await createFulfillableOrder()
        const res = await api.post(
          "/admin/orders/fulfillments/batch",
          {
            fulfillments: [
              {
                order_id: seeder.order.id,
                location_id: seeder.stockLocation.id,
                shipment_id: "shp_events_void",
                rate_id: "rate_1",
              },
            ],
          },
          adminHeaders
        )
        expect(res.data.succeeded).toEqual([seeder.order.id])
        const voided = await api.post(`/admin/orders/${seeder.order.id}/void-label`, {}, adminHeaders)

        const events = await getEvents(seeder.order.id)
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: "order.label_voided",
          actor: { id: adminUserId },
          new_value: { fulfillment_ids: voided.data.voided.map((v) => v.fulfillment_id) },
        })
      })

      it("records mark-shipped with carrier, tracking number and fulfillment", async () => {
        const { order } = await createFulfillableOrder()
        const res = await api.post(
          `/admin/orders/${order.id}/mark-shipped`,
          { carrier: "UPS", tracking_number: "1Z999EV1" },
          adminHeaders
        )
        expect(res.status).toBe(200)
        const events = await getEvents(order.id)
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: "order.marked_shipped",
          actor: { id: adminUserId },
          new_value: { carrier: "UPS", tracking_number: "1Z999EV1", fulfillment_id: res.data.fulfillment_id },
        })
      })

      it("records order.shipped and order.delivered from the EasyPost webhook with the system actor", async () => {
        const seeder = await createFulfillableOrder()
        const fulfilled = (
          await api.post(
            `/admin/orders/${seeder.order.id}/fulfillments?fields=id,*fulfillments`,
            {
              shipping_option_id: seeder.shippingOption.id,
              location_id: seeder.stockLocation.id,
              items: seeder.order.items.map((i) => ({ id: i.id, quantity: i.quantity })),
            },
            adminHeaders
          )
        ).data.order
        const fulfillmentId = fulfilled.fulfillments[0].id
        await container
          .resolve(Modules.FULFILLMENT)
          .updateFulfillment(fulfillmentId, { data: { easypost_tracking_code: "EZ_EVENTS_0001" } })

        const post = (status: string) => {
          const raw = JSON.stringify({
            description: "tracker.updated",
            result: { tracking_code: "EZ_EVENTS_0001", status },
          })
          return api.post("/webhooks/easypost", raw, {
            headers: { "Content-Type": "application/json", "X-Hmac-Signature": signRawBody(raw) },
            validateStatus: () => true,
          })
        }

        expect((await post("in_transit")).status).toBe(200)
        expect((await post("in_transit")).status).toBe(200)
        expect((await post("delivered")).status).toBe(200)

        const events = await getEvents(seeder.order.id)
        expect(events.map((e) => e.type)).toEqual(["order.delivered", "order.shipped"])
        for (const e of events) {
          expect(e.actor).toBe("system")
          expect(e.new_value).toEqual({ fulfillment_id: fulfillmentId })
        }
      })
    })
  },
})
