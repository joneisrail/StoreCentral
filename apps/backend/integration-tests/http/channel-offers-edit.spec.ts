import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let counter = 0
    let locationId: string

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
      locationId = (
        await api.post(
          "/admin/stock-locations",
          { name: `Warehouse ${++counter}` },
          adminHeaders
        )
      ).data.stock_location.id
    })

    const createChannel = async (name: string) =>
      (await api.post("/admin/sales-channels", { name: `${name} ${++counter}` }, adminHeaders))
        .data.sales_channel.id as string

    const createVariant = async (opts: { manage_inventory: boolean; stocked?: number; reserved?: number }) => {
      counter += 1
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Product ${counter}`,
            options: [{ title: "size", values: ["l"] }],
            variants: [
              {
                title: "V",
                sku: `SKU-${counter}`,
                manage_inventory: opts.manage_inventory,
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "l" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      const variant = product.variants[0]
      if (opts.manage_inventory) {
        const { data } = await api.get(
          `/admin/inventory-items?sku=${variant.sku}`,
          adminHeaders
        )
        const itemId = data.inventory_items[0].id
        await api.post(
          `/admin/inventory-items/${itemId}/location-levels`,
          { location_id: locationId, stocked_quantity: opts.stocked ?? 0 },
          adminHeaders
        )
      }
      return variant.id as string
    }

    const post = (variantId: string, channelId: string, body: unknown, headers: any = adminHeaders) =>
      api
        .post(`/admin/channel-offers/${variantId}/${channelId}`, body, headers)
        .catch((e) => e.response)

    const rows = async (variantId: string) =>
      (getContainer().resolve(CHANNEL_OFFERS_MODULE) as any).listForVariant(variantId)

    describe("POST /admin/channel-offers/:variant_id/:channel_id", () => {
      it("sets stock and price, records an edit movement, marks pending", async () => {
        const ch = await createChannel("A")
        const v = await createVariant({ manage_inventory: true, stocked: 10 })
        const res = await post(v, ch, { stock: 6, price: 19.99 })
        expect(res.status).toBe(200)
        const [row] = await rows(v)
        expect(row).toMatchObject({ sales_channel_id: ch, stock: 6, price: 19.99, sync_state: "pending" })
        const movements = await (getContainer().resolve(CHANNEL_OFFERS_MODULE) as any).listChannelStockMovements({ variant_id: v })
        expect(movements).toHaveLength(1)
        expect(movements[0]).toMatchObject({ kind: "edit", delta: 6, sales_channel_id: ch })
      })

      it("an edit that changes nothing writes no movement and keeps the sync state", async () => {
        const ch = await createChannel("A")
        const v = await createVariant({ manage_inventory: true, stocked: 10 })
        await post(v, ch, { stock: 4, price: 8 })
        const svc = getContainer().resolve(CHANNEL_OFFERS_MODULE) as any
        await svc.markSync(v, ch, { state: "synced", price: 8, stock: 4 })
        const res = await post(v, ch, { stock: 4, price: 8 })
        expect(res.status).toBe(200)
        expect(res.data.kind).toBeNull()
        expect(res.data.offer).toMatchObject({ stock: 4, price: 8 })
        expect((await rows(v))[0].sync_state).toBe("synced")
        expect(await svc.listChannelStockMovements({ variant_id: v })).toHaveLength(1)
      })

      it("allows price null", async () => {
        const ch = await createChannel("A")
        const v = await createVariant({ manage_inventory: true, stocked: 5 })
        await post(v, ch, { price: 5 })
        const res = await post(v, ch, { price: null })
        expect(res.status).toBe(200)
        expect((await rows(v))[0].price).toBeNull()
      })

      it("rejects over-allocation with the free-unit count", async () => {
        const a = await createChannel("A")
        const b = await createChannel("B")
        const v = await createVariant({ manage_inventory: true, stocked: 10 })
        expect((await post(v, a, { stock: 7 })).status).toBe(200)
        const res = await post(v, b, { stock: 4 })
        expect(res.status).toBe(400)
        expect(JSON.stringify(res.data)).toMatch(/only 3 unit/i)
        expect((await post(v, b, { stock: 3 })).status).toBe(200)
      })

      it("concurrent edits cannot exceed the available total", async () => {
        const a = await createChannel("A")
        const b = await createChannel("B")
        const v = await createVariant({ manage_inventory: true, stocked: 10 })
        const results = await Promise.all([post(v, a, { stock: 8 }), post(v, b, { stock: 8 })])
        expect(results.map((r) => r.status).sort()).toEqual([200, 400])
        const total = (await rows(v)).reduce((s: number, r: any) => s + r.stock, 0)
        expect(total).toBeLessThanOrEqual(10)
      })

      it("rejects negative and malformed bodies", async () => {
        const ch = await createChannel("A")
        const v = await createVariant({ manage_inventory: true, stocked: 5 })
        for (const body of [{ stock: -1 }, { price: -1 }, { stock: 1.5 }, {}, { stock: 1, extra: 1 }]) {
          expect((await post(v, ch, body)).status).toBe(400)
        }
      })

      it("rejects stock edits for a variant that does not manage inventory", async () => {
        const ch = await createChannel("A")
        const v = await createVariant({ manage_inventory: false })
        const res = await post(v, ch, { stock: 1 })
        expect(res.status).toBe(400)
        expect(JSON.stringify(res.data)).toMatch(/manage/i)
        expect((await post(v, ch, { price: 3 })).status).toBe(200)
      })

      it("404s an unknown channel and an unknown variant", async () => {
        const ch = await createChannel("A")
        const v = await createVariant({ manage_inventory: true, stocked: 5 })
        expect((await post(v, "sc_missing", { price: 1 })).status).toBe(404)
        expect((await post("variant_missing", ch, { price: 1 })).status).toBe(404)
      })

      it("rejects unauthenticated requests with 401", async () => {
        const res = await api
          .post("/admin/channel-offers/variant_x/sc_x", { price: 1 })
          .catch((e) => e.response)
        expect(res.status).toBe(401)
      })
    })
  },
})
