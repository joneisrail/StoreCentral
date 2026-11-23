import { expect, test, vi } from "vitest"
import type { WooCommerceClient } from "./client.js"
import { listWooCatalog, listWooListings, setWooPrice, setWooStock } from "./products.js"

const fakeClient = (handler: (method: string, path: string, opts?: any) => any) => {
  const request = vi.fn(async (method: string, path: string, opts?: any) =>
    handler(method, path, opts)
  )
  return { request, client: { request } as unknown as WooCommerceClient }
}

test("lists products and variations across pages, omitting SKU-less entries", async () => {
  const { client, request } = fakeClient((_m, path, opts) => {
    const page = opts?.query?.page
    if (path === "/products" && page === 1) {
      return {
        totalPages: 2,
        data: [
          { id: 1, sku: "A", type: "simple", regular_price: "10.00" },
          { id: 2, sku: "", type: "simple", regular_price: "1.00" },
          { id: 3, sku: "", type: "variable", regular_price: "" },
        ],
      }
    }
    if (path === "/products" && page === 2) {
      return {
        totalPages: 2,
        data: [{ id: 4, sku: " B ", type: "simple", regular_price: "", price: "7.00" }],
      }
    }
    if (path === "/products/3/variations" && page === 1) {
      return { totalPages: 2, data: [{ id: 30, sku: "V1", regular_price: "5.00" }] }
    }
    if (path === "/products/3/variations" && page === 2) {
      return {
        totalPages: 2,
        data: [
          { id: 31, sku: "V2", regular_price: "6.00" },
          { id: 32, sku: "", regular_price: "6.00" },
        ],
      }
    }
    throw new Error(`unexpected ${path} ${page}`)
  })
  const out = await listWooListings(client)
  expect(out).toEqual([
    { id: 1, parentId: null, sku: "A", price: "10.00" },
    { id: 30, parentId: 3, sku: "V1", price: "5.00" },
    { id: 31, parentId: 3, sku: "V2", price: "6.00" },
    { id: 4, parentId: null, sku: "B", price: "7.00" },
  ])
  expect(request.mock.calls[0][2].query).toEqual({ per_page: 100, page: 1 })
})

test("setWooStock on a simple product", async () => {
  const { client, request } = fakeClient(() => ({ data: {}, totalPages: 1 }))
  await setWooStock(client, { id: 7, parentId: null, quantity: 12 })
  expect(request).toHaveBeenCalledWith("PUT", "/products/7", {
    body: { manage_stock: true, stock_quantity: 12 },
  })
})

test("setWooStock on a variation uses the parent path", async () => {
  const { client, request } = fakeClient(() => ({ data: {}, totalPages: 1 }))
  await setWooStock(client, { id: 31, parentId: 3, quantity: 2 })
  expect(request.mock.calls[0][1]).toBe("/products/3/variations/31")
})

test("setWooStock clamps negatives and floors fractions", async () => {
  const { client, request } = fakeClient(() => ({ data: {}, totalPages: 1 }))
  await setWooStock(client, { id: 7, parentId: null, quantity: -3 })
  await setWooStock(client, { id: 7, parentId: null, quantity: 4.9 })
  expect(request.mock.calls[0][2].body.stock_quantity).toBe(0)
  expect(request.mock.calls[1][2].body.stock_quantity).toBe(4)
})

test("setWooPrice sends only regular_price", async () => {
  const { client, request } = fakeClient(() => ({ data: {}, totalPages: 1 }))
  await setWooPrice(client, { id: 7, parentId: null, price: "12.50" })
  await setWooPrice(client, { id: 31, parentId: 3, price: "12.50" })
  expect(request.mock.calls[0]).toEqual([
    "PUT",
    "/products/7",
    { body: { regular_price: "12.50" } },
  ])
  expect(request.mock.calls[1][1]).toBe("/products/3/variations/31")
})

test("lists only simple products and variations; skips variable, grouped and external parents; skips a variation whose SKU equals its parent's (inherited), keeps one with its own SKU", async () => {
  const { client } = fakeClient((_m, path, opts) => {
    if (path === "/products") {
      return {
        totalPages: 1,
        data: [
          { id: 1, sku: "PARENT", type: "variable", regular_price: "" },
          { id: 2, sku: "G", type: "grouped", regular_price: "" },
          { id: 3, sku: "E", type: "external", regular_price: "1.00" },
          { id: 4, sku: "S", type: "simple", regular_price: "2.00" },
        ],
      }
    }
    if (path === "/products/1/variations") {
      return {
        totalPages: 1,
        data: [
          { id: 10, sku: "PARENT", regular_price: "5.00" },
          { id: 11, sku: "V2", regular_price: "6.00" },
        ],
      }
    }
    throw new Error(`unexpected ${path} ${opts?.query?.page}`)
  })
  expect(await listWooListings(client)).toEqual([
    { id: 11, parentId: 1, sku: "V2", price: "6.00" },
    { id: 4, parentId: null, sku: "S", price: "2.00" },
  ])
})

test("listWooCatalog: simple with sku", async () => {
  const { client } = fakeClient(() => ({
    totalPages: 1,
    data: [
      {
        id: 1, sku: " A ", type: "simple", name: "Mug", regular_price: "10.00",
        price: "8.00", manage_stock: true, stock_quantity: 5,
        images: [{ src: "http://x/1.jpg" }],
      },
    ],
  }))
  expect(await listWooCatalog(client)).toEqual([
    {
      externalId: "1", parentExternalId: null, sku: " A ", title: "Mug",
      parentTitle: null, price: "10.00", stock: 5,
      imageUrl: "http://x/1.jpg", currency: null,
    },
  ])
})

test("listWooCatalog: simple without sku is kept with sku null", async () => {
  const { client } = fakeClient(() => ({
    totalPages: 1,
    data: [{ id: 2, sku: "  ", type: "simple", name: "Cup", regular_price: "", price: "3.00" }],
  }))
  const out = await listWooCatalog(client)
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ externalId: "2", sku: null, price: "3.00", imageUrl: null })
})

test("listWooCatalog: variation inheriting parent sku gets null", async () => {
  const { client } = fakeClient((_m, path) => {
    if (path === "/products")
      return {
        totalPages: 1,
        data: [{ id: 3, sku: "P", type: "variable", name: "Shirt", images: [{ src: "p.jpg" }] }],
      }
    if (path === "/products/3/variations")
      return {
        totalPages: 1,
        data: [
          { id: 30, sku: "P", name: "Shirt - S", regular_price: "5.00", stock_quantity: 1 },
          { id: 31, sku: "V2", name: "Shirt - M", regular_price: "6.00", stock_quantity: 2 },
        ],
      }
    throw new Error(`unexpected ${path}`)
  })
  const out = await listWooCatalog(client)
  expect(out.map((l) => [l.externalId, l.parentExternalId, l.sku, l.parentTitle])).toEqual([
    ["30", "3", null, "Shirt"],
    ["31", "3", "V2", "Shirt"],
  ])
  expect(out[0].imageUrl).toBe("p.jpg")
})

test("listWooCatalog: unmanaged stock is null", async () => {
  const { client } = fakeClient(() => ({
    totalPages: 1,
    data: [{ id: 4, sku: "S", type: "simple", name: "N", regular_price: "1", stock_quantity: null }],
  }))
  expect((await listWooCatalog(client))[0].stock).toBeNull()
})

test("listWooCatalog only issues GET", async () => {
  const { client, request } = fakeClient(() => ({ totalPages: 1, data: [] }))
  await listWooCatalog(client)
  expect(request.mock.calls.every((c) => c[0] === "GET")).toBe(true)
})
