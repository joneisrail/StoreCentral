import { expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import { ShopifyClient } from "./client.js"
import { fetchShopifyOrdersSince, normalizeShopifyOrder } from "./orders.js"

const line = (sku: string | null, qty: number, amount: string) => ({
  sku,
  quantity: qty,
  discountedUnitPriceSet: { shopMoney: { amount, currencyCode: "USD" } },
})
const raw = (over: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Order/100",
  name: "#1001",
  displayFinancialStatus: "PAID",
  cancelledAt: null,
  email: "b@example.com",
  lineItems: { nodes: [line("SKU-1", 2, "8.50"), line(null, 1, "3.00")] },
  shippingLines: { nodes: [{ title: "Ground" }] },
  taxLines: [{ title: "Tax" }],
  shippingAddress: {
    firstName: "Ann",
    lastName: "Lee",
    address1: "1 Main",
    city: "Reno",
    countryCodeV2: "US",
    zip: "89501",
  },
  ...over,
})

test("normalizes a happy-path order", () => {
  expect(normalizeShopifyOrder(raw())).toEqual({
    shopifyOrderId: "gid://shopify/Order/100",
    orderName: "#1001",
    financialStatus: "PAID",
    currencyCode: "USD",
    lineItemsTruncated: false,
    cancelledAt: null,
    buyerEmail: "b@example.com",
    items: [
      { sku: "SKU-1", quantity: 2, unitPrice: 8.5 },
      { sku: "", quantity: 1, unitPrice: 3 },
    ],
    shippingAddress: {
      first_name: "Ann",
      last_name: "Lee",
      address_1: "1 Main",
      city: "Reno",
      country_code: "US",
      postal_code: "89501",
    },
  })
})

test("currencyCode prefers the order currency, else the line shop money", () => {
  expect(normalizeShopifyOrder(raw({ currencyCode: "CAD" })).currencyCode).toBe(
    "CAD"
  )
  expect(normalizeShopifyOrder(raw()).currencyCode).toBe("USD")
})

test("flags orders whose line items span more than one page", () => {
  const paged = raw({
    lineItems: { pageInfo: { hasNextPage: true }, nodes: [line("A", 1, "1")] },
  })
  expect(normalizeShopifyOrder(paged).lineItemsTruncated).toBe(true)
  expect(normalizeShopifyOrder(raw()).lineItemsTruncated).toBe(false)
})

test("shipping and tax lines are not items", () => {
  expect(normalizeShopifyOrder(raw()).items).toHaveLength(2)
})

test("malformed orders throw PermanentSyncError", () => {
  expect(() => normalizeShopifyOrder(null)).toThrow(PermanentSyncError)
  expect(() => normalizeShopifyOrder({})).toThrow(PermanentSyncError)
  expect(() => normalizeShopifyOrder(raw({ lineItems: undefined }))).toThrow(
    PermanentSyncError
  )
  expect(() =>
    normalizeShopifyOrder(raw({ lineItems: { nodes: [line("A", 1, "abc")] } }))
  ).toThrow(PermanentSyncError)
})

test("fetchShopifyOrdersSince paginates with the updated_at filter", async () => {
  const page = (nodes: unknown[], next: boolean, c: string | null) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      data: { orders: { nodes, pageInfo: { hasNextPage: next, endCursor: c } } },
    }),
  })
  const f = vi
    .fn()
    .mockResolvedValueOnce(page([raw()], true, "c1"))
    .mockResolvedValueOnce(
      page([raw({ id: "gid://shopify/Order/101" })], false, null)
    )
  const client = new ShopifyClient({
    shopDomain: "s",
    accessToken: "t",
    fetchImpl: f as unknown as typeof fetch,
    sleep: async () => {},
  })
  const out = await fetchShopifyOrdersSince(client, "2026-11-01T00:00:00Z")
  expect(out.map((o) => o.shopifyOrderId)).toEqual([
    "gid://shopify/Order/100",
    "gid://shopify/Order/101",
  ])
  const v = JSON.parse(f.mock.calls[0][1].body).variables
  expect(v.query).toBe("updated_at:>=2026-11-01T00:00:00Z")
  expect(JSON.parse(f.mock.calls[1][1].body).variables.after).toBe("c1")
})

test("trims stray whitespace from line item SKUs, blank stays empty", () => {
  const order = normalizeShopifyOrder(
    raw({ lineItems: { nodes: [line("  SKU-1 ", 1, "1.00"), line("   ", 1, "1.00")] } })
  )
  expect(order.items.map((i) => i.sku)).toEqual(["SKU-1", ""])
})
