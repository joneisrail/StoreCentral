import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(100000)

// Proves which entities/fields the Query graph can filter at the data layer
// (the findings are recorded in the Task 3 report).
medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let order: any
    let stockLocation: any
    let fulfillmentId: string

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
      const inv = (await api.post(`/admin/inventory-items`, { sku: "fld-inv" }, adminHeaders)).data.inventory_item
      const sp = (await api.post(`/admin/shipping-profiles`, { name: "fld-profile", type: "default" }, adminHeaders)).data
        .shipping_profile
      const product = (
        await api.post(
          "/admin/products",
          {
            title: "Zebra Widget",
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: sp.id,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title: "V",
                sku: "FLD-SKU-123",
                inventory_items: [{ inventory_item_id: inv.id, required_quantity: 1 }],
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "large" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      const seeded = await createOrderSeeder({
        api,
        container,
        productOverride: product,
        inventoryItemOverride: inv,
        shippingProfileOverride: sp,
      })
      order = seeded.order
      stockLocation = seeded.stockLocation
      const res = await api.post(
        `/admin/orders/${order.id}/mark-shipped`,
        { carrier: "UPS", tracking_number: "1ZFIELDTRACK9" },
        adminHeaders
      )
      fulfillmentId = res.data.fulfillment_id
      await container.resolve(Modules.FULFILLMENT).updateFulfillment(fulfillmentId, {
        data: { easypost_carrier: "USPS" },
      })
    })

    const q = () => container.resolve(ContainerRegistrationKeys.QUERY)

    const graph = async (args: any) => (await q().graph(args)).data as any[]
    const idsOf = (rows: any[], key = "id") => rows.map((r) => r[key])

    it("order_line_item: variant_sku, title and product_title are filterable; order_item maps item -> order", async () => {
      const items = await graph({
        entity: "order_line_item",
        fields: ["id", "variant_sku", "title", "product_title"],
        filters: { $or: [{ variant_sku: { $ilike: "%fld-sku%" } }, { product_title: { $ilike: "%nomatch%" } }] },
      })
      expect(items).toHaveLength(1)
      const links = await graph({ entity: "order_item", fields: ["order_id", "item_id"], filters: { item_id: [items[0].id] } })
      expect(idsOf(links, "order_id")).toContain(order.id)
      for (const f of [{ title: { $ilike: "%zebra%" } }, { product_title: { $ilike: "%zebra%" } }]) {
        expect(await graph({ entity: "order_line_item", fields: ["id"], filters: f })).toHaveLength(1)
      }
    })

    it("fulfillment: labels.tracking_number, location_id and JSON data/metadata paths are filterable; order_fulfillment links to the order", async () => {
      expect(
        idsOf(await graph({ entity: "fulfillment", fields: ["id"], filters: { labels: { tracking_number: { $ilike: "%fieldtrack%" } } } }))
      ).toEqual([fulfillmentId])
      expect(
        idsOf(await graph({ entity: "fulfillment", fields: ["id"], filters: { location_id: stockLocation.id } }))
      ).toEqual([fulfillmentId])
      for (const f of [
        { data: { easypost_carrier: { $ilike: "usps" } } },
        { metadata: { carrier: { $ilike: "ups" } } },
      ]) {
        expect(idsOf(await graph({ entity: "fulfillment", fields: ["id"], filters: f }))).toEqual([fulfillmentId])
      }
      expect(
        await graph({ entity: "fulfillment", fields: ["id"], filters: { data: { easypost_carrier: { $ilike: "us" } } } })
      ).toEqual([])
      const links = await graph({ entity: "order_fulfillment", fields: ["order_id", "fulfillment_id"], filters: { fulfillment_id: [fulfillmentId] } })
      expect(links[0].order_id).toBe(order.id)
    })

    it("order: q, shipping_address.country_code and shipping_methods.shipping_method_id are filterable; order_shipping_method.name is an entity", async () => {
      const methods = await graph({ entity: "order_shipping_method", fields: ["id", "name"], filters: { name: { $ilike: "%test shipping%" } } })
      expect(methods).toHaveLength(1)
      const rows = await graph({
        entity: "order",
        fields: ["id"],
        filters: {
          q: "stark",
          is_draft_order: false,
          shipping_address: { country_code: { $ilike: "US" } },
          shipping_methods: { shipping_method_id: [methods[0].id] },
        },
        pagination: { take: 5, order: { created_at: "DESC" } },
      })
      expect(idsOf(rows)).toEqual([order.id])
    })
  },
})
