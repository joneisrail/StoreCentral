import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"

jest.setTimeout(900000)

// Timing probe for GET /admin/order-search?q= over ~2,000 orders with line items.
// Reports the time on the console; there is deliberately NO timing assertion.
// Skipped unless ORDER_SEARCH_PERF=1 so CI stays fast:
//   ORDER_SEARCH_PERF=1 yarn test:integration:http integration-tests/http/order-search-performance.spec.ts
const ORDERS = 2000
const run = process.env.ORDER_SEARCH_PERF === "1" ? describe : describe.skip

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    run("order search performance", () => {
      beforeAll(async () => {
        const container = getContainer()
        await createAdminUser(dbConnection, adminHeaders, container)
        const orders = container.resolve(Modules.ORDER)
        const started = Date.now()
        for (let from = 0; from < ORDERS; from += 200) {
          await orders.createOrders(
            Array.from({ length: 200 }, (_, j) => {
              const n = from + j
              return {
                currency_code: "usd",
                email: `buyer${n}@perf-example.test`,
                shipping_address: { first_name: `Buyer${n}`, last_name: "Perf", address_1: `${n} Main St`, country_code: "us" },
                items: [
                  { title: `Gadget ${n % 50}`, product_title: `Gadget ${n % 50}`, variant_sku: `PERF-SKU-${n}`, quantity: 1, unit_price: 10 },
                  { title: `Gizmo ${n % 40}`, product_title: `Gizmo ${n % 40}`, variant_sku: `PERF-GZ-${n}`, quantity: 2, unit_price: 5 },
                ],
              }
            })
          )
        }
        console.log(`order-search perf: seeded ${ORDERS} orders in ${Date.now() - started} ms`)
      })

      it("times the q path", async () => {
        const time = async (label: string, qs: string) => {
          const t = Date.now()
          const res = await api.get(`/admin/order-search?${qs}`, adminHeaders)
          console.log(`order-search perf: ${label} -> ${res.data.order_ids.length} ids, truncated=${res.data.truncated}, ${Date.now() - t} ms`)
        }
        await time("q=warm-up", "q=warmup")
        await time("q=perf-sku-1999 (single match)", "q=perf-sku-1999")
        await time("q=PERF-SKU (all match, truncated)", "q=PERF-SKU")
        await time("q=gadget 7 (title)", "q=gadget%207")
        await time("q=buyer12@perf (email)", "q=buyer12%40perf")
        await time("q=no-such-text", "q=no-such-text")
        await time("sku=perf-gz-5 + country=us", "sku=perf-gz-5&country=us")
      })
    })
  },
})
