import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"

/**
 * Proves channel edits serialize through the Redis locking provider.
 *
 * Needs a real Redis, so it only runs when REDIS_TEST_URL is set, for example
 *   REDIS_TEST_URL=redis://localhost:6379/15
 * Redis database 15 is reserved for tests. The usual backend test database
 * variables are required as well (DB_HOST, DB_USERNAME, DB_PASSWORD), same as
 * the other specs in this folder. Run it with:
 *   yarn test:integration:http channel-offers-redis-lock
 *
 * When REDIS_TEST_URL is set this file exports BACKEND_REDIS_MODULES=true and
 * REDIS_URL=<REDIS_TEST_URL> before the runner starts. medusa-config.ts reads
 * them when the runner loads it (in its beforeAll), so the Redis event bus,
 * workflow engine and locking modules are used. CI exports REDIS_TEST_URL.
 * When it is unset the suite is skipped and the default in-memory modules
 * stay in place for every other spec.
 */

jest.setTimeout(300000)

const redisTestUrl = process.env.REDIS_TEST_URL

if (!redisTestUrl) {
  describe.skip("channel edits serialize through the Redis lock (skipped: REDIS_TEST_URL is not set)", () => {
    it("needs REDIS_TEST_URL, for example redis://localhost:6379/15", () => undefined)
  })
} else {
  process.env.BACKEND_REDIS_MODULES = "true"
  process.env.REDIS_URL = redisTestUrl

  medusaIntegrationTestRunner({
    testSuite: ({ dbConnection, getContainer, api }) => {
      let counter = 0

      beforeEach(async () => {
        await createAdminUser(dbConnection, adminHeaders, getContainer())
      })

      const offers = () => getContainer().resolve(CHANNEL_OFFERS_MODULE) as any

      const post = (variantId: string, channelId: string, body: unknown) =>
        api
          .post(`/admin/channel-offers/${variantId}/${channelId}`, body, adminHeaders)
          .catch((e) => e.response)

      const setup = async () => {
        counter += 1
        const channelId = (
          await api.post("/admin/sales-channels", { name: `Lock channel ${counter}` }, adminHeaders)
        ).data.sales_channel.id as string
        const locationId = (
          await api.post("/admin/stock-locations", { name: `Lock warehouse ${counter}` }, adminHeaders)
        ).data.stock_location.id as string
        const product = (
          await api.post(
            "/admin/products",
            {
              title: `Lock product ${counter}`,
              options: [{ title: "size", values: ["l"] }],
              variants: [
                {
                  title: "V",
                  sku: `LOCK-${counter}`,
                  manage_inventory: true,
                  prices: [{ currency_code: "usd", amount: 100 }],
                  options: { size: "l" },
                },
              ],
            },
            adminHeaders
          )
        ).data.product
        const variant = product.variants[0]
        const { data } = await api.get(`/admin/inventory-items?sku=${variant.sku}`, adminHeaders)
        await api.post(
          `/admin/inventory-items/${data.inventory_items[0].id}/location-levels`,
          { location_id: locationId, stocked_quantity: 10 },
          adminHeaders
        )
        return { variantId: variant.id as string, channelId }
      }

      describe("channel edits with the Redis locking provider", () => {
        it("uses the Redis modules in this run", () => {
          expect(process.env.BACKEND_REDIS_MODULES).toBe("true")
          expect(process.env.REDIS_URL).toBe(redisTestUrl)
        })

        it("two concurrent stock edits on one variant and channel end in the sequential outcome", async () => {
          const { variantId, channelId } = await setup()

          const results = await Promise.all([
            post(variantId, channelId, { stock: 3 }),
            post(variantId, channelId, { stock: 5 }),
          ])
          expect(results.map((r) => r.status)).toEqual([200, 200])

          const row = (await offers().listForVariant(variantId)).find(
            (r: any) => r.sales_channel_id === channelId
          )
          // Whichever edit ran last wins, never a blend of the two.
          expect([3, 5]).toContain(row.stock)

          const movements = (await offers().listChannelStockMovements({
            variant_id: variantId,
            sales_channel_id: channelId,
          })) as any[]
          expect(movements).toHaveLength(2)
          // Serialized edits chain: 0 -> first -> second. Each delta is
          // computed from the stock the previous edit left, so the deltas
          // add up to the final stock. Unserialized edits would both start
          // from 0 and their deltas (3 + 5) would not match the final stock.
          const total = movements.reduce((sum, m) => sum + m.delta, 0)
          expect(total).toBe(row.stock)
        })
      })
    },
  })
}
