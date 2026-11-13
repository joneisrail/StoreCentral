import { expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import type { WooCommerceClient } from "./client.js"
import {
  fetchWooOrder,
  fetchWooOrdersModifiedSince,
  normalizeWooOrder,
} from "./orders.js"

const addr = {
  first_name: "Ann",
  last_name: "Lee",
  email: "",
  address_1: "1 Main St",
  city: "Austin",
  country: "US",
  postcode: "78701",
}
const raw = (over: Record<string, unknown> = {}) => ({
  id: 99,
  status: "processing",
  currency: "USD",
  billing: { ...addr, email: "ann@example.com" },
  shipping: addr,
  line_items: [{ sku: "A", quantity: 2, total: "18.00", subtotal: "20.00" }],
  tax_lines: [{ tax_total: "1.50" }],
  shipping_lines: [{ total: "5.00" }],
  fee_lines: [{ total: "1.00" }],
  ...over,
})

test("normalizes the happy path; unit price from discounted total, taxes/shipping/fees excluded", () => {
  expect(normalizeWooOrder(raw())).toEqual({
    wooOrderId: "99",
    status: "processing",
    currencyCode: "USD",
    buyerEmail: "ann@example.com",
    items: [{ sku: "A", quantity: 2, unitPrice: 9 }],
    shippingAddress: {
      first_name: "Ann",
      last_name: "Lee",
      address_1: "1 Main St",
      city: "Austin",
      country_code: "US",
      postal_code: "78701",
    },
  })
})

test("rounds the unit price to a cent", () => {
  const o = normalizeWooOrder(
    raw({ line_items: [{ sku: "A", quantity: 3, total: "10.00" }] })
  )
  expect(o.items[0].unitPrice).toBe(3.33)
})

test("trims SKUs and maps a missing SKU to empty string", () => {
  const o = normalizeWooOrder(
    raw({
      line_items: [
        { sku: "  A  ", quantity: 1, total: "5.00" },
        { quantity: 1, total: "5.00" },
        { sku: "", quantity: 1, total: "5.00" },
      ],
    })
  )
  expect(o.items.map((i) => i.sku)).toEqual(["A", "", ""])
})

test("falls back to billing when shipping is empty", () => {
  const o = normalizeWooOrder(
    raw({
      shipping: {
        ...addr,
        first_name: "",
        last_name: "",
        address_1: "",
        city: "",
        country: "",
        postcode: "",
      },
    })
  )
  expect(o.shippingAddress.address_1).toBe("1 Main St")
  expect(o.shippingAddress.first_name).toBe("Ann")
})

test.each([
  ["null", null],
  ["no id", raw({ id: undefined })],
  ["no line_items", raw({ line_items: undefined })],
  ["bad quantity", raw({ line_items: [{ sku: "A", quantity: "x", total: "1.00" }] })],
  ["bad total", raw({ line_items: [{ sku: "A", quantity: 1, total: "abc" }] })],
  ["zero quantity", raw({ line_items: [{ sku: "A", quantity: 0, total: "1.00" }] })],
])("malformed order throws PermanentSyncError (%s)", (_n, bad) => {
  expect(() => normalizeWooOrder(bad)).toThrow(PermanentSyncError)
})

const fakeClient = (handler: (path: string, opts?: any) => any) => {
  const request = vi.fn(async (_m: string, path: string, opts?: any) =>
    handler(path, opts)
  )
  return { request, client: { request } as unknown as WooCommerceClient }
}

test("fetchWooOrder GETs and normalizes", async () => {
  const { client, request } = fakeClient(() => ({ data: raw(), totalPages: 1 }))
  const o = await fetchWooOrder(client, "99")
  expect(o.wooOrderId).toBe("99")
  expect(request.mock.calls[0].slice(0, 2)).toEqual(["GET", "/orders/99"])
})

test("fetchWooOrdersModifiedSince paginates with modified_after, dates_are_gmt=true and status=any", async () => {
  const { client, request } = fakeClient((_p, opts) =>
    opts.query.page === 1
      ? { data: [{ id: 1 }, { id: 2 }], totalPages: 2 }
      : { data: [{ id: 3 }], totalPages: 2 }
  )
  const out = await fetchWooOrdersModifiedSince(client, "2026-01-01T00:00:00Z")
  expect(out).toEqual([{ wooOrderId: "1" }, { wooOrderId: "2" }, { wooOrderId: "3" }])
  expect(request.mock.calls[0][2].query).toEqual({
    modified_after: "2026-01-01T00:00:00Z",
    dates_are_gmt: "true",
    status: "any",
    per_page: 100,
    page: 1,
  })
})
