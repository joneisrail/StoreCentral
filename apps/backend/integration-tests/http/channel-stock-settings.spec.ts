import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { readShareStockSetting } from "../../src/modules/channel-offers/settings"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    beforeAll(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
    })

    describe("/admin/channel-stock-settings", () => {
      it("defaults to false", async () => {
        const res = await api.get("/admin/channel-stock-settings", adminHeaders)
        expect(res.status).toBe(200)
        expect(res.data).toEqual({ share_stock_after_sale: false })
      })

      it("persists via POST and is read by readShareStockSetting", async () => {
        const post = await api.post(
          "/admin/channel-stock-settings",
          { share_stock_after_sale: true },
          adminHeaders
        )
        expect(post.status).toBe(200)
        expect(post.data).toEqual({ share_stock_after_sale: true })
        const res = await api.get("/admin/channel-stock-settings", adminHeaders)
        expect(res.data).toEqual({ share_stock_after_sale: true })
        expect(await readShareStockSetting(getContainer())).toBe(true)

        await api.post(
          "/admin/channel-stock-settings",
          { share_stock_after_sale: false },
          adminHeaders
        )
        expect(
          (await api.get("/admin/channel-stock-settings", adminHeaders)).data
        ).toEqual({ share_stock_after_sale: false })
      })

      it("preserves other store metadata", async () => {
        const store = (await api.get("/admin/stores", adminHeaders)).data
          .stores[0]
        await api.post(
          `/admin/stores/${store.id}`,
          { metadata: { high_value_threshold: 900 } },
          adminHeaders
        )
        await api.post(
          "/admin/channel-stock-settings",
          { share_stock_after_sale: true },
          adminHeaders
        )
        const after = (await api.get("/admin/stores", adminHeaders)).data
          .stores[0]
        expect(after.metadata.high_value_threshold).toBe(900)
        expect(after.metadata.share_stock_after_sale).toBe(true)
      })

      it("rejects non-boolean and unknown keys", async () => {
        for (const body of [
          { share_stock_after_sale: "yes" },
          { share_stock_after_sale: 1 },
          {},
          { share_stock_after_sale: true, extra: 1 },
        ]) {
          const res = await api
            .post("/admin/channel-stock-settings", body, adminHeaders)
            .catch((e) => e.response)
          expect(res.status).toBe(400)
        }
      })

      it("rejects unauthenticated requests with 401", async () => {
        const g = await api.get("/admin/channel-stock-settings").catch((e) => e.response)
        expect(g.status).toBe(401)
        const p = await api
          .post("/admin/channel-stock-settings", { share_stock_after_sale: true })
          .catch((e) => e.response)
        expect(p.status).toBe(401)
      })
    })
  },
})
