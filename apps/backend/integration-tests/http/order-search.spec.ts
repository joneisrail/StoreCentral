import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { searchOrders } from "../../src/api/admin/order-search/search"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let counter = 0
    // order 1: UPS (manual, metadata.carrier) + tracking number, SKU with an underscore
    // order 2: USPS (EasyPost data.easypost_carrier), other customer email
    // order 3: not fulfilled, shipping address in GB
    let o1: any, o2: any, o3: any

    const createOrder = async (sku: string, productTitle: string) => {
      const suffix = `search-${counter++}`
      const inv = (await api.post(`/admin/inventory-items`, { sku: `${suffix}-inv` }, adminHeaders)).data.inventory_item
      const sp = (await api.post(`/admin/shipping-profiles`, { name: `${suffix}-profile`, type: "default" }, adminHeaders))
        .data.shipping_profile
      const product = (
        await api.post(
          "/admin/products",
          {
            title: productTitle,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: sp.id,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title: "Variant",
                sku,
                inventory_items: [{ inventory_item_id: inv.id, required_quantity: 1 }],
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
        productOverride: product,
        inventoryItemOverride: inv,
        shippingProfileOverride: sp,
      })
    }

    const search = async (params: Record<string, string>) => {
      const res = await api.get(`/admin/order-search?${new URLSearchParams(params).toString()}`, adminHeaders)
      return res.data as { order_ids: string[]; truncated: boolean }
    }
    const sorted = (ids: string[]) => [...ids].sort()

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
      const orderModule = container.resolve(Modules.ORDER)
      const fulfillment = container.resolve(Modules.FULFILLMENT)

      const s1 = await createOrder("SRCH-ALPHA_01", "Zebra Widget")
      o1 = s1
      const ship = await api.post(
        `/admin/orders/${s1.order.id}/mark-shipped`,
        { carrier: "UPS", tracking_number: "1ZSEARCH0001" },
        adminHeaders
      )
      o1.fulfillmentId = ship.data.fulfillment_id

      const s2 = await createOrder("SRCH-BETA-02", "Quokka Gadget")
      o2 = s2
      await orderModule.updateOrders(s2.order.id, { email: "zoe@unique-mail.test" })
      const fulfilled = (
        await api.post(
          `/admin/orders/${s2.order.id}/fulfillments?fields=id,*fulfillments`,
          {
            shipping_option_id: s2.shippingOption.id,
            location_id: s2.stockLocation.id,
            items: s2.order.items.map((i) => ({ id: i.id, quantity: i.quantity })),
          },
          adminHeaders
        )
      ).data.order
      o2.fulfillmentId = fulfilled.fulfillments[0].id
      await fulfillment.updateFulfillment(o2.fulfillmentId, { data: { easypost_carrier: "USPS" } })

      const s3 = await createOrder("SRCH-GAMMA-03", "Narwhal Gizmo")
      o3 = s3
      await orderModule.updateOrderAddresses([{ id: s3.order.shipping_address.id, country_code: "gb" }])
    })

    describe("GET /admin/order-search", () => {
      it("requires authentication", async () => {
        const res = await api.get(`/admin/order-search?q=zebra`).catch((e) => e.response)
        expect(res.status).toBe(401)
      })

      it("400s on empty, too-short, unknown and malformed input", async () => {
        for (const qs of ["", "q=a", "q=%20a%20", "country=usa", "q=ab&limit=5", "bogus=1", "sku=", "q=", "carrier=", "ship_from=", "delivery=", "delivery=%20%20", "country=us&delivery="]) {
          const res = await api.get(`/admin/order-search?${qs}`, adminHeaders).catch((e) => e.response)
          expect(res.status).toBe(400)
        }
      })

      it("matches a SKU partially and case-insensitively", async () => {
        expect((await search({ q: "alpha" })).order_ids).toEqual([o1.order.id])
        expect((await search({ sku: "srch-BETA" })).order_ids).toEqual([o2.order.id])
        expect((await search({ sku: "SRCH" })).order_ids).toHaveLength(3)
      })

      it("matches a product title via q", async () => {
        expect((await search({ q: "quokka" })).order_ids).toEqual([o2.order.id])
        expect((await search({ q: "NARWHAL gi" })).order_ids).toEqual([o3.order.id])
        expect((await search({ q: "narwhal" })).order_ids).toEqual([o3.order.id])
      })

      it("matches a tracking number via q, partially and case-insensitively", async () => {
        expect(await search({ q: "1zsearch0001" })).toEqual({ order_ids: [o1.order.id], truncated: false })
        expect((await search({ q: "search000" })).order_ids).toEqual([o1.order.id])
      })

      it("filters by country, case-insensitively", async () => {
        expect((await search({ country: "gb" })).order_ids).toEqual([o3.order.id])
        expect(sorted((await search({ country: "US" })).order_ids)).toEqual(sorted([o1.order.id, o2.order.id]))
      })

      it("filters by carrier from metadata.carrier (manual) and data.easypost_carrier (EasyPost), equals only", async () => {
        expect((await search({ carrier: "ups" })).order_ids).toEqual([o1.order.id])
        expect((await search({ carrier: "UsPs" })).order_ids).toEqual([o2.order.id])
        expect((await search({ carrier: "up" })).order_ids).toEqual([])
      })

      it("filters by ship_from (fulfillment location)", async () => {
        expect((await search({ ship_from: o2.stockLocation.id })).order_ids).toEqual([o2.order.id])
        expect((await search({ ship_from: "sloc_missing" })).order_ids).toEqual([])
      })

      it("filters by delivery (shipping method name)", async () => {
        expect((await search({ delivery: o1.fulfillmentSet.id.toUpperCase() })).order_ids).toEqual([o1.order.id])
        expect((await search({ delivery: "no such method" })).order_ids).toEqual([])
      })

      it("AND-combines parameters", async () => {
        expect((await search({ sku: "srch", carrier: "ups", country: "us" })).order_ids).toEqual([o1.order.id])
        expect((await search({ sku: "srch", carrier: "ups", country: "gb" })).order_ids).toEqual([])
        expect((await search({ q: "zebra", ship_from: o2.stockLocation.id })).order_ids).toEqual([])
      })

      it("q equals the standard GET /admin/orders?q= result for a customer email", async () => {
        const standard = (await api.get(`/admin/orders?q=unique-mail&fields=id`, adminHeaders)).data.orders
        const found = await search({ q: "unique-mail" })
        expect(found.order_ids).toEqual(standard.map((o) => o.id))
        expect(found.order_ids).toEqual([o2.order.id])
        const stark = (await api.get(`/admin/orders?q=stark-industries&fields=id`, adminHeaders)).data.orders
        expect(sorted((await search({ q: "stark-industries" })).order_ids)).toEqual(sorted(stark.map((o) => o.id)))
      })

      it("returns newest orders first", async () => {
        expect((await search({ sku: "SRCH" })).order_ids).toEqual([o3.order.id, o2.order.id, o1.order.id])
      })

      it("treats % _ and \\ as literal characters, never as wildcards", async () => {
        for (const q of ["%%", "__", "\\\\", "%a%", "a%"]) {
          const res = await api.get(`/admin/order-search?${new URLSearchParams({ q }).toString()}`, adminHeaders)
          // "%a%" / "a%" contain the literal "a" but no order text contains "%".
          expect(res.data.order_ids).toEqual([])
        }
        // "_" is a literal underscore: matches the SKU that has one, not "ALPHA-01"-like neighbours.
        expect((await search({ sku: "ALPHA_01" })).order_ids).toEqual([o1.order.id])
        expect((await search({ sku: "ALPHA-01" })).order_ids).toEqual([])
        expect((await search({ sku: "ALPH_" })).order_ids).toEqual([])
        expect((await search({ sku: "SRCH-___" })).order_ids).toEqual([])
      })

      it("ignores canceled (voided) fulfillments for tracking number, carrier and ship_from", async () => {
        const s4 = await createOrder("SRCH-DELTA-04", "Okapi Thing")
        const ship = await api.post(
          `/admin/orders/${s4.order.id}/mark-shipped`,
          { carrier: "DHLX", tracking_number: "1ZVOIDED001" },
          adminHeaders
        )
        expect((await search({ q: "1zvoided001" })).order_ids).toEqual([s4.order.id])
        expect((await search({ carrier: "dhlx" })).order_ids).toEqual([s4.order.id])
        expect((await search({ ship_from: s4.stockLocation.id })).order_ids).toEqual([s4.order.id])

        await container
          .resolve(Modules.FULFILLMENT)
          .updateFulfillment(ship.data.fulfillment_id, { canceled_at: new Date() } as any)

        expect((await search({ q: "1zvoided001" })).order_ids).toEqual([])
        expect((await search({ carrier: "dhlx" })).order_ids).toEqual([])
        expect((await search({ ship_from: s4.stockLocation.id })).order_ids).toEqual([])
        // the order itself is still found by its SKU
        expect((await search({ sku: "DELTA-04" })).order_ids).toEqual([s4.order.id])
      })

      it("keeps the NEWEST candidates and the newest orders when a candidate cap is hit", async () => {
        const orderModule = container.resolve(Modules.ORDER)
        const fulfillment = container.resolve(Modules.FULFILLMENT)
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        const created: string[] = []
        for (let i = 0; i < 6; i++) {
          const order = await orderModule.createOrders({ currency_code: "usd", email: `cap${i}@cap.test` })
          const f = await fulfillment.createFulfillment({
            location_id: "sloc_captest",
            provider_id: "manual_manual",
            delivery_address: { address_1: "1 Cap St", country_code: "us" },
            items: [],
            labels: [],
            data: {},
            metadata: {},
          } as any)
          await link.create({
            [Modules.ORDER]: { order_id: order.id },
            [Modules.FULFILLMENT]: { fulfillment_id: f.id },
          })
          created.push(order.id)
        }
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const res = await searchOrders(query, { ship_from: "sloc_captest" }, { candidateCap: 3, maxResults: 2 })
        // candidates kept: fulfillments of the 3 newest orders; of those the newest 2 are returned
        expect(res).toEqual({ order_ids: [created[5], created[4]], truncated: true })
        const all = await searchOrders(query, { ship_from: "sloc_captest" })
        expect(all).toEqual({ order_ids: [...created].reverse(), truncated: false })
      })

      it("returns an empty list when nothing matches", async () => {
        expect(await search({ q: "no-such-thing-anywhere" })).toEqual({ order_ids: [], truncated: false })
      })
    })
  },
})
