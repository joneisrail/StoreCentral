import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let counter = 0
    let locationId: string
    let storeId: string
    let hubConnections: any[] | "down"
    const realFetch = global.fetch

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
      locationId = (
        await api.post("/admin/stock-locations", { name: `Warehouse ${++counter}` }, adminHeaders)
      ).data.stock_location.id
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      const { data } = await query.graph({ entity: "store", fields: ["id"] })
      storeId = data[0].id
      await api.post(
        `/admin/stores/${storeId}`,
        { supported_currencies: [{ currency_code: "usd", is_default: true }] },
        adminHeaders
      )
      hubConnections = []
      process.env.SELLER_HUB_INTERNAL_URL = "http://seller-hub.test"
      process.env.SELLER_HUB_INTERNAL_SECRET = "test-secret"
      global.fetch = (async (url: any, init?: any) => {
        if (!String(url).startsWith("http://seller-hub.test")) return realFetch(url, init)
        if (hubConnections === "down") throw new Error("ECONNREFUSED")
        return new Response(JSON.stringify({ connections: hubConnections }), { status: 200 })
      }) as any
    })

    afterEach(() => {
      global.fetch = realFetch
    })

    const svc = () => getContainer().resolve(CHANNEL_OFFERS_MODULE) as any

    const createChannel = async (name: string) =>
      (await api.post("/admin/sales-channels", { name }, adminHeaders)).data.sales_channel.id as string

    const createVariant = async (opts: {
      title?: string
      vtitle?: string
      sku?: string
      stocked?: number
      price?: number
    }) => {
      counter += 1
      const sku = opts.sku ?? `SKU-${counter}`
      const product = (
        await api.post(
          "/admin/products",
          {
            title: opts.title ?? `Product ${counter}`,
            options: [{ title: "size", values: ["l"] }],
            variants: [
              {
                title: opts.vtitle ?? "V",
                sku,
                manage_inventory: opts.stocked !== undefined,
                prices: [{ currency_code: "usd", amount: opts.price ?? 100 }],
                options: { size: "l" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      const variant = product.variants[0]
      if (opts.stocked !== undefined) {
        const { data } = await api.get(`/admin/inventory-items?sku=${sku}`, adminHeaders)
        await api.post(
          `/admin/inventory-items/${data.inventory_items[0].id}/location-levels`,
          { location_id: locationId, stocked_quantity: opts.stocked },
          adminHeaders
        )
      }
      return variant.id as string
    }

    const grid = async (qs = "") => (await api.get(`/admin/channel-offers${qs}`, adminHeaders)).data
    const bad = (qs: string) => api.get(`/admin/channel-offers${qs}`, adminHeaders).catch((e) => e.response)
    const enc = encodeURIComponent
    const ids = (res: any) => res.rows.map((r: any) => r.variant_id)

    describe("GET /admin/channel-offers", () => {
      it("searches product title, variant title and SKU case-insensitively", async () => {
        const a = await createVariant({ title: "Blue Widget", vtitle: "Small", sku: "AAA-1" })
        const b = await createVariant({ title: "Red Gadget", vtitle: "Zebra Edition", sku: "BBB-2" })
        const c = await createVariant({ title: "Green Thing", vtitle: "Plain", sku: "CCC-NEEDLE-3" })
        expect(ids(await grid("?q=widget"))).toEqual([a])
        expect(ids(await grid("?q=zebra"))).toEqual([b])
        const bySku = await grid("?q=needle")
        expect(ids(bySku)).toEqual([c])
        expect(bySku.count).toBe(1)
        expect(bySku.rows[0]).toMatchObject({
          product_title: "Green Thing",
          variant_title: "Plain",
          sku: "CCC-NEEDLE-3",
          base_price: 100,
        })
      })

      it("treats % _ and backslash in the search text literally", async () => {
        const a = await createVariant({ title: "50% off bundle", sku: "PLAIN-1" })
        await createVariant({ title: "50X off bundle", sku: "PLAIN-2" })
        const c = await createVariant({ title: "Other", sku: "AB_1" })
        await createVariant({ title: "Other two", sku: "ABX1" })
        const d = await createVariant({ title: "Back\\slash", sku: "PLAIN-5" })
        expect(ids(await grid("?q=" + enc("50% off")))).toEqual([a])
        expect(ids(await grid("?q=" + enc("B_1")))).toEqual([c])
        expect(ids(await grid("?q=" + enc("k\\s")))).toEqual([d])
        const onlyWild = await grid("?q=" + enc("%%"))
        expect(onlyWild.rows).toEqual([])
        expect(onlyWild.count).toBe(0)
        expect(ids(await grid("?q=" + enc("_")))).toEqual([])
      })

      it("sorts by a channel's stock across all variants and pages server side", async () => {
        const ch = await createChannel("Marketplace A")
        const stocks = [3, 9, 1, 7, 5]
        const vs: string[] = []
        for (let i = 0; i < stocks.length; i++) vs.push(await createVariant({ stocked: 20 }))
        await svc().ensureOffers(vs, [ch])
        for (let i = 0; i < vs.length; i++) await svc().setStocks(vs[i], { [ch]: stocks[i] })

        const asc = await grid(`?order=${ch}:stock&limit=2&offset=0`)
        expect(asc.count).toBe(5)
        expect(asc.rows.map((r: any) => r.channels[ch].stock)).toEqual([1, 3])
        const asc2 = await grid(`?order=${ch}:stock&limit=2&offset=2`)
        expect(asc2.rows.map((r: any) => r.channels[ch].stock)).toEqual([5, 7])
        const desc = await grid(`?order=-${ch}:stock&limit=2`)
        expect(desc.rows.map((r: any) => r.channels[ch].stock)).toEqual([9, 7])
        const last = await grid(`?order=-${ch}:stock&limit=2&offset=4`)
        expect(last.rows.map((r: any) => r.channels[ch].stock)).toEqual([1])
        expect(last.count).toBe(5)
      })

      it("computes available and unallocated (floored at 0)", async () => {
        const a = await createChannel("A")
        const b = await createChannel("B")
        const v1 = await createVariant({ stocked: 10 })
        const v2 = await createVariant({ stocked: 4 })
        const v3 = await createVariant({}) // not stock managed
        await svc().ensureOffers([v1, v2, v3], [a, b])
        await svc().setStocks(v1, { [a]: 3, [b]: 2 })
        await svc().setStocks(v2, { [a]: 3, [b]: 3 }) // over-allocated: 6 of 4
        const res = await grid()
        const byId = Object.fromEntries(res.rows.map((r: any) => [r.variant_id, r]))
        expect(byId[v1]).toMatchObject({ available: 10, unallocated: 5 })
        expect(byId[v2]).toMatchObject({ available: 4, unallocated: 0 })
        expect(byId[v3]).toMatchObject({ available: 0, unallocated: 0 })
        // default order is total ascending
        expect(res.rows.map((r: any) => r.available)).toEqual([0, 4, 10])
        expect((await grid("?order=-total")).rows.map((r: any) => r.available)).toEqual([10, 4, 0])
        expect((await grid("?order=-unallocated")).rows[0].variant_id).toBe(v1)
      })

      it("web store and POS effective price is the base price; others use channel price else base", async () => {
        const web = await createChannel("Webshop")
        await api.post(`/admin/stores/${storeId}`, { default_sales_channel_id: web }, adminHeaders)
        const pos = await createChannel("Point of Sale")
        const mp = await createChannel("Etsy")
        const other = await createChannel("Wholesale")
        hubConnections = [{ sales_channel_id: mp, status: "connected" }]
        const v = await createVariant({ stocked: 10, price: 100 })
        await svc().ensureOffers([v], [web, pos, mp, other])
        await svc().setPrice(v, web, 5)
        await svc().setPrice(v, pos, 6)
        await svc().setPrice(v, mp, 7.5)
        const res = await grid()
        const row = res.rows.find((r: any) => r.variant_id === v)
        expect(row.base_price).toBe(100)
        expect(row.channels[web]).toMatchObject({ price: 5, effective_price: 100, has_connection: false })
        expect(row.channels[pos]).toMatchObject({ price: 6, effective_price: 100 })
        expect(row.channels[mp]).toMatchObject({ price: 7.5, effective_price: 7.5, has_connection: true })
        expect(row.channels[other]).toMatchObject({ price: null, effective_price: 100, sync_state: "pending" })
        const kinds = Object.fromEntries(res.channels.map((c: any) => [c.id, c.kind]))
        expect(kinds[web]).toBe("web")
        expect(kinds[pos]).toBe("pos")
        expect(kinds[mp]).toBe("marketplace")
        expect(kinds[other]).toBe("other")
        expect(res.channels.find((c: any) => c.id === mp)).toMatchObject({ name: "Etsy", has_connection: true })
        // channel_ids narrows the channels and the per-row maps
        const narrowed = await grid(`?channel_ids=${mp}`)
        expect(narrowed.channels.map((c: any) => c.id)).toEqual([mp])
        expect(Object.keys(narrowed.rows[0].channels)).toEqual([mp])
        // sort by the effective price of a channel
        const w2 = await createVariant({ stocked: 1, price: 50 })
        await svc().ensureOffers([w2], [web, pos, mp, other])
        const byPrice = await grid(`?order=${other}:price`)
        expect(byPrice.rows.map((r: any) => r.channels[other].effective_price)).toEqual([50, 100])
      })

      it("answers 200 with every has_connection false when seller-hub is down", async () => {
        const mp = await createChannel("Etsy")
        const v = await createVariant({ stocked: 3 })
        await svc().ensureOffers([v], [mp])
        hubConnections = "down"
        const res = await api.get("/admin/channel-offers", adminHeaders)
        expect(res.status).toBe(200)
        expect(res.data.channels.find((c: any) => c.id === mp)).toMatchObject({
          has_connection: false,
          kind: "other",
        })
        expect(res.data.rows[0].channels[mp].has_connection).toBe(false)
      })

      it("validates the query", async () => {
        expect((await bad("?limit=101")).status).toBe(400)
        expect((await bad("?limit=0")).status).toBe(400)
        expect((await bad("?offset=-1")).status).toBe(400)
        expect((await bad("?order=bogus")).status).toBe(400)
        expect((await bad("?nope=1")).status).toBe(400)
      })
    })
  },
})
