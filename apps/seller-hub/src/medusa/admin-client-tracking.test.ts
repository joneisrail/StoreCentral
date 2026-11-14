import { expect, test, vi } from "vitest"
import { MedusaAdminClient } from "./admin-client.js"

const makeClient = (orderResponse: () => Response) => {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith("/auth/user/emailpass")) {
      return new Response(JSON.stringify({ token: "t" }), { status: 200 })
    }
    return orderResponse()
  })
  const client = new MedusaAdminClient({
    baseUrl: "http://m",
    email: "e",
    password: "p",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { client, calls }
}

test("getOrderForTracking maps fields", async () => {
  const { client, calls } = makeClient(
    () =>
      new Response(
        JSON.stringify({
          order: {
            id: "order_1",
            metadata: { shopify_account_id: "a" },
            items: [{ id: "li_1", variant_sku: "SKU1", quantity: 2 }, { id: "li_2", quantity: 1 }],
            fulfillments: [
              {
                id: "ful_1",
                canceled_at: null,
                data: { easypost_carrier: "USPS" },
                items: [{ line_item_id: "li_1", quantity: 2 }],
                labels: [
                  { tracking_number: "", tracking_url: "" },
                  { tracking_number: "9400", tracking_url: "https://t/9400" },
                ],
              },
              {
                id: "ful_2",
                canceled_at: "2026-01-01",
                data: { carrier: "UPS" },
                metadata: { carrier: "FedEx" },
                items: [],
                labels: [],
              },
              { id: "ful_3", metadata: { carrier: "DHL" } },
            ],
          },
        }),
        { status: 200 }
      )
  )
  const order = await client.getOrderForTracking("order_1")
  expect(calls[1]).toContain("/admin/orders/order_1?fields=")
  expect(calls[1]).toContain("fulfillments.labels.tracking_number")
  expect(order).toEqual({
    id: "order_1",
    metadata: { shopify_account_id: "a" },
    items: [
      { id: "li_1", sku: "SKU1", quantity: 2 },
      { id: "li_2", sku: null, quantity: 1 },
    ],
    fulfillments: [
      {
        id: "ful_1",
        canceledAt: null,
        items: [{ lineItemId: "li_1", quantity: 2 }],
        labels: [{ trackingNumber: "9400", trackingUrl: "https://t/9400" }],
        carrier: "USPS",
      },
      { id: "ful_2", canceledAt: "2026-01-01", items: [], labels: [], carrier: "UPS" },
      { id: "ful_3", canceledAt: null, items: [], labels: [], carrier: "DHL" },
    ],
  })
})

test("getOrderForTracking returns null on 404 and throws on other errors", async () => {
  expect(
    await makeClient(() => new Response("{}", { status: 404 })).client.getOrderForTracking("x")
  ).toBeNull()
  await expect(
    makeClient(() => new Response("{}", { status: 500 })).client.getOrderForTracking("x")
  ).rejects.toThrow(/status 500/)
})
