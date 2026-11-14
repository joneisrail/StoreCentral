import { Client } from "@medusajs/js-sdk"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ProductStatus } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"

jest.setTimeout(300000)

// The dashboard serialises the list query with the js-sdk client. Capture the
// exact query string it produces for a query object.
const sdkQueryString = async (query: Record<string, unknown>) => {
  const original = global.fetch
  let url = ""
  global.fetch = (async (input: any) => {
    url = String(input)
    return new Response("{}", { status: 200 })
  }) as any
  try {
    const client = new Client({ baseUrl: "http://localhost:9000" } as any)
    await client.fetch("/admin/orders", { query })
  } finally {
    global.fetch = original
  }
  return url.slice(url.indexOf("?"))
}

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let container
    let cheap: any
    let pricey: any

    const createOrder = async (suffix: string, amount: number) => {
      const inv = (
        await api.post(
          `/admin/inventory-items`,
          { sku: `${suffix}-inv` },
          adminHeaders
        )
      ).data.inventory_item
      const sp = (
        await api.post(
          `/admin/shipping-profiles`,
          { name: `${suffix}-profile`, type: "default" },
          adminHeaders
        )
      ).data.shipping_profile
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Total filter ${suffix}`,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: sp.id,
            options: [{ title: "size", values: ["large"] }],
            variants: [
              {
                title: "Variant",
                sku: `${suffix}-sku`,
                inventory_items: [
                  { inventory_item_id: inv.id, required_quantity: 1 },
                ],
                prices: [{ currency_code: "usd", amount }],
                options: { size: "large" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      return (
        await createOrderSeeder({
          api,
          container,
          productOverride: product,
          inventoryItemOverride: inv,
          shippingProfileOverride: sp,
        })
      ).order
    }

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(dbConnection, adminHeaders, container)
      cheap = await createOrder("total-cheap", 100)
      pricey = await createOrder("total-pricey", 5000)
    })

    const listIds = async (query: Record<string, unknown>) => {
      const qs = await sdkQueryString({ ...query, fields: "id,total" })
      const res = await api.get(`/admin/orders${qs}`, adminHeaders)
      return res.data.orders.map((o) => o.id)
    }

    it("totals are in major currency units (1 = $1, not 1 cent)", () => {
      // 100 line item + shipping; the cents interpretation would be 10000+.
      expect(Number(cheap.total)).toBeGreaterThan(100)
      expect(Number(cheap.total)).toBeLessThan(2000)
      expect(Number(pricey.total)).toBeGreaterThan(5000)
      expect(Number(pricey.total)).toBeLessThan(7000)
    })

    it("filters by a total range sent as the dashboard sends it", async () => {
      const lo = Math.floor(Number(cheap.total)) + 100
      const hi = Math.ceil(Number(pricey.total)) + 100
      expect(
        decodeURIComponent(
          await sdkQueryString({ total: { $gte: lo, $lte: hi } })
        )
      ).toContain(`total[$gte]=${lo}&total[$lte]=${hi}`)
      const ids = await listIds({ total: { $gte: lo, $lte: hi } })
      expect(ids).toContain(pricey.id)
      expect(ids).not.toContain(cheap.id)
    })

    // KNOWN SERVER LIMITATION (core, not changed here): the list endpoint
    // compares summary.totals.current_order_total as TEXT, so numeric ranges
    // are only right when both sides have the same number of digits. This is
    // why the dashboard has no Total filter. If this test starts failing the
    // server was fixed and the filter can come back (totals are major units).
    it("compares totals as text, so numeric ranges across digit counts are wrong", async () => {
      // numerically both orders are >= 999 and neither is < 9
      expect(await listIds({ total: { $gte: 999 } })).toEqual([])
      const lt9 = await listIds({ total: { $lt: 9 } })
      expect(lt9).toContain(cheap.id)
      expect(lt9).toContain(pricey.id)
    })

    it("filters by an exact total", async () => {
      const ids = await listIds({ total: { $eq: Number(pricey.total) } })
      expect(ids).toEqual([pricey.id])
    })
  },
})
