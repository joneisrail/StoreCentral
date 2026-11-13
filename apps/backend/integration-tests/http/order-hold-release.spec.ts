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

    describe("hold and release", () => {
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

      it("holds an open order, rejects a shipped one, then releases", async () => {
        const open = (await createDistinctOrderSeeder("hold-open")).order
        const shippedSeeder = await createDistinctOrderSeeder("hold-shipped")
        const shipped = shippedSeeder.order

        const fulfilled = (
          await api.post(
            `/admin/orders/${shipped.id}/fulfillments?fields=id,*fulfillments`,
            {
              shipping_option_id: shippedSeeder.shippingOption.id,
              location_id: shippedSeeder.stockLocation.id,
              items: shipped.items.map((i) => ({ id: i.id, quantity: i.quantity })),
            },
            adminHeaders
          )
        ).data.order
        await api.post(
          `/admin/orders/${shipped.id}/fulfillments/${fulfilled.fulfillments[0].id}/shipments`,
          { items: shipped.items.map((i) => ({ id: i.id, quantity: i.quantity })) },
          adminHeaders
        )

        const held = await api.post(`/admin/orders/${open.id}/hold`, { reason: "Check address" }, adminHeaders)
        expect(held.status).toBe(200)
        expect(held.data).toEqual({ order_id: open.id, on_hold: true })
        const after = (await api.get(`/admin/orders/${open.id}?fields=id,metadata,*tags`, adminHeaders)).data.order
        expect(after.tags.map((t) => t.value)).toContain("On hold")
        expect(after.metadata.hold.reason).toBe("Check address")

        const again = await api.post(`/admin/orders/${open.id}/hold`, { reason: "x" }, adminHeaders).catch((e) => e.response)
        expect(again.status).toBe(400)

        const rejected = await api
          .post(`/admin/orders/${shipped.id}/hold`, { reason: "x" }, adminHeaders)
          .catch((e) => e.response)
        expect(rejected.status).toBe(400)

        const released = await api.post(`/admin/orders/${open.id}/release`, {}, adminHeaders)
        expect(released.data).toEqual({ order_id: open.id, on_hold: false })
        const cleared = (await api.get(`/admin/orders/${open.id}?fields=id,metadata,*tags`, adminHeaders)).data.order
        expect(cleared.tags.map((t) => t.value)).not.toContain("On hold")
        expect(cleared.metadata?.hold).toBeUndefined()
      })
    })
  },
})
