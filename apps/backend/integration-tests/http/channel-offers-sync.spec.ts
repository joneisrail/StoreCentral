import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let counter = 0
    let hubConnections: any[] | "down"
    const realFetch = global.fetch

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      const { data } = await query.graph({ entity: "store", fields: ["id"] })
      await api.post(
        `/admin/stores/${data[0].id}`,
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
    const createChannel = async (name: string, metadata?: Record<string, unknown>) =>
      (await api.post("/admin/sales-channels", { name: `${name} ${++counter}`, metadata }, adminHeaders)).data
        .sales_channel.id as string
    const createVariant = async (price = 100) => {
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
                manage_inventory: false,
                prices: [{ currency_code: "usd", amount: price }],
                options: { size: "l" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      return product.variants[0].id as string
    }
    const connect = (channelId: string) => {
      hubConnections = [{ sales_channel_id: channelId, status: "connected" }]
    }
    const base = (v: string, c: string) => `/admin/channel-offers/${v}/${c}`
    const post = (path: string, body?: unknown, headers: any = adminHeaders) =>
      api.post(path, body, headers).catch((e) => e.response)
    const get = (path: string, headers: any = adminHeaders) => api.get(path, headers).catch((e) => e.response)
    const offerOf = async (v: string, c: string) =>
      (await svc().listForVariant(v)).find((r: any) => r.sales_channel_id === c)

    describe("POST /admin/channel-offers/:variant_id/:channel_id/sync", () => {
      it("answers 400 with a clear message when the channel has no connection", async () => {
        const ch = await createChannel("Plain")
        const v = await createVariant()
        const res = await post(`${base(v, ch)}/sync`)
        expect(res.status).toBe(400)
        expect(JSON.stringify(res.data)).toMatch(/no marketplace connection/i)
      })

      it("reports a seller-hub outage as an error, not as no connection", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        hubConnections = "down"
        const res = await post(`${base(v, ch)}/sync`)
        expect(res.status).toBeGreaterThanOrEqual(500)
        expect(JSON.stringify(res.data)).not.toMatch(/no marketplace connection/i)
      })

      it("queues the sync and emits channel-offer.changed with kind both and force true", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        connect(ch)
        const bus: any = getContainer().resolve(Modules.EVENT_BUS)
        const emitted: any[] = []
        const original = bus.emit.bind(bus)
        bus.emit = async (messages: any, options?: any) => {
          for (const m of Array.isArray(messages) ? messages : [messages]) emitted.push(m)
          return original(messages, options)
        }
        try {
          const res = await post(`${base(v, ch)}/sync`)
          expect(res.status).toBe(200)
          expect(res.data).toEqual({ queued: true })
        } finally {
          bus.emit = original
        }
        const evt = emitted.find((m) => m.name === "channel-offer.changed")
        expect(evt?.data).toEqual({ variant_id: v, sales_channel_id: ch, kind: "both", force: true })
      })

      it("404s an unknown channel and an unknown variant", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        connect(ch)
        expect((await post(`${base(v, "sc_missing")}/sync`)).status).toBe(404)
        expect((await post(`${base("variant_missing", ch)}/sync`)).status).toBe(404)
      })

      it("rejects unauthenticated requests with 401", async () => {
        expect((await post("/admin/channel-offers/variant_x/sc_x/sync", undefined, {})).status).toBe(401)
      })
    })

    describe("GET /admin/channel-offers/:variant_id/:channel_id/push-values", () => {
      it("returns the channel price, effective price and stock", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant(100)
        connect(ch)
        await svc().ensureOffers([v], [ch])
        await svc().setPrice(v, ch, 19.5)
        await svc().setStocks(v, { [ch]: 7 })
        const res = await get(`${base(v, ch)}/push-values`)
        expect(res.status).toBe(200)
        expect(res.data).toEqual({ price: 19.5, effective_price: 19.5, stock: 7 })
      })

      it("falls back to the base price when the channel price is null", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant(42)
        connect(ch)
        await svc().ensureOffers([v], [ch])
        const res = await get(`${base(v, ch)}/push-values`)
        expect(res.data).toEqual({ price: null, effective_price: 42, stock: 0 })
      })

      it("uses the variant base price for web and POS channels even with a channel price", async () => {
        const web = await createChannel("Web", { kind: "web" })
        const pos = await createChannel("POS", { kind: "pos" })
        const v = await createVariant(60)
        await svc().ensureOffers([v], [web, pos])
        await svc().setPrice(v, web, 5)
        await svc().setPrice(v, pos, 6)
        expect((await get(`${base(v, web)}/push-values`)).data).toEqual({
          price: 5,
          effective_price: 60,
          stock: 0,
        })
        expect((await get(`${base(v, pos)}/push-values`)).data).toEqual({
          price: 6,
          effective_price: 60,
          stock: 0,
        })
      })

      it("404s an unknown channel and an unknown variant", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        expect((await get(`${base(v, "sc_missing")}/push-values`)).status).toBe(404)
        expect((await get(`${base("variant_missing", ch)}/push-values`)).status).toBe(404)
      })

      it("rejects unauthenticated requests with 401", async () => {
        expect((await get("/admin/channel-offers/variant_x/sc_x/push-values", {})).status).toBe(401)
      })
    })

    describe("POST /admin/channel-offers/:variant_id/:channel_id/sync-result", () => {
      it("records a synced result with last_synced values", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        await svc().ensureOffers([v], [ch])
        await svc().setStocks(v, { [ch]: 3 })
        await svc().setPrice(v, ch, 12.5)
        const res = await post(`${base(v, ch)}/sync-result`, { state: "synced", price: 12.5, stock: 3 })
        expect(res.status).toBe(200)
        const row = await offerOf(v, ch)
        expect(row).toMatchObject({
          sync_state: "synced",
          last_synced_price: 12.5,
          last_synced_stock: 3,
          last_error: null,
        })
        expect(row.last_synced_at).toBeTruthy()
      })

      it("a stock-only synced report keeps an unpushed channel price pending", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        await svc().ensureOffers([v], [ch])
        await svc().setStocks(v, { [ch]: 3 })
        await svc().setPrice(v, ch, 12.5)
        const res = await post(`${base(v, ch)}/sync-result`, { state: "synced", stock: 3 })
        expect(res.status).toBe(200)
        expect(await offerOf(v, ch)).toMatchObject({
          sync_state: "pending",
          last_synced_stock: 3,
          last_synced_price: null,
        })
      })

      it("records a failed result and truncates the error to 500 characters", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        await svc().ensureOffers([v], [ch])
        const res = await post(`${base(v, ch)}/sync-result`, { state: "failed", error: "x".repeat(900) })
        expect(res.status).toBe(200)
        const row = await offerOf(v, ch)
        expect(row.sync_state).toBe("failed")
        expect(row.last_error).toBe("x".repeat(500))
      })

      it("rejects unknown keys and invalid bodies with 400", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        await svc().ensureOffers([v], [ch])
        for (const body of [
          { state: "synced", sync_state: "synced" },
          { state: "pending" },
          { error: "x" },
          { state: "synced", stock: 1.5 },
          { state: "synced", price: -1 },
          {},
        ]) {
          expect((await post(`${base(v, ch)}/sync-result`, body)).status).toBe(400)
        }
        expect((await offerOf(v, ch)).sync_state).toBe("pending")
      })

      it("404s when there is no such channel offer", async () => {
        const ch = await createChannel("Amz")
        const v = await createVariant()
        expect((await post(`${base(v, "sc_missing")}/sync-result`, { state: "synced" })).status).toBe(404)
        expect((await post(`${base("variant_missing", ch)}/sync-result`, { state: "synced" })).status).toBe(404)
      })

      it("rejects unauthenticated requests with 401", async () => {
        expect(
          (await post("/admin/channel-offers/variant_x/sc_x/sync-result", { state: "synced" }, {})).status
        ).toBe(401)
      })
    })
  },
})
