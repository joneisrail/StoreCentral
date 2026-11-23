import { expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import { ShopifyClient } from "./client.js"
import { listShopifyCatalog, listShopifyVariants, updateShopifyVariantPrice } from "./products.js"

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ data }),
})
const clientFor = (f: unknown) =>
  new ShopifyClient({
    shopDomain: "s.myshopify.com",
    accessToken: "t",
    fetchImpl: f as typeof fetch,
    sleep: async () => {},
  })
const node = (n: number, sku: string | null) => ({
  id: `gid://shopify/ProductVariant/${n}`,
  sku,
  price: "9.99",
  inventoryItem: { id: `gid://shopify/InventoryItem/${n}` },
})

test("listShopifyVariants paginates across two pages", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      ok({
        productVariants: {
          nodes: [node(1, "A")],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      })
    )
    .mockResolvedValueOnce(
      ok({
        productVariants: {
          nodes: [node(2, null)],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      })
    )
  const out = await listShopifyVariants(clientFor(f))
  expect(out).toEqual([
    {
      variantId: "gid://shopify/ProductVariant/1",
      sku: "A",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      price: "9.99",
    },
    {
      variantId: "gid://shopify/ProductVariant/2",
      sku: null,
      inventoryItemId: "gid://shopify/InventoryItem/2",
      price: "9.99",
    },
  ])
  expect(JSON.parse(f.mock.calls[1][1].body).variables.after).toBe("c1")
})

test("updateShopifyVariantPrice sends the string price", async () => {
  const f = vi
    .fn()
    .mockResolvedValue(ok({ productVariantsBulkUpdate: { userErrors: [] } }))
  await updateShopifyVariantPrice(clientFor(f), {
    productId: "gid://shopify/Product/9",
    variantId: "gid://shopify/ProductVariant/1",
    price: "12.50",
  })
  const vars = JSON.parse(f.mock.calls[0][1].body).variables
  expect(vars.productId).toBe("gid://shopify/Product/9")
  expect(vars.variants).toEqual([
    { id: "gid://shopify/ProductVariant/1", price: "12.50" },
  ])
})

test("updateShopifyVariantPrice looks up the product when not given", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      ok({ productVariant: { product: { id: "gid://shopify/Product/7" } } })
    )
    .mockResolvedValueOnce(
      ok({ productVariantsBulkUpdate: { userErrors: [] } })
    )
  await updateShopifyVariantPrice(clientFor(f), {
    variantId: "v1",
    price: "1.00",
  })
  expect(JSON.parse(f.mock.calls[1][1].body).variables.productId).toBe(
    "gid://shopify/Product/7"
  )
})

test("userErrors become PermanentSyncError", async () => {
  const f = vi.fn().mockResolvedValue(
    ok({
      productVariantsBulkUpdate: {
        userErrors: [{ field: ["price"], message: "bad" }],
      },
    })
  )
  await expect(
    updateShopifyVariantPrice(clientFor(f), {
      productId: "p",
      variantId: "v",
      price: "x",
    })
  ).rejects.toBeInstanceOf(PermanentSyncError)
})

const cnode = (n: number, sku: string | null) => ({
  id: `gid://shopify/ProductVariant/${n}`,
  sku,
  title: `Var ${n}`,
  price: "9.99",
  inventoryQuantity: n,
  inventoryItem: { id: `gid://shopify/InventoryItem/${n}` },
  product: {
    id: "gid://shopify/Product/1",
    title: "Prod",
    featuredImage: { url: "http://img/1.jpg" },
  },
})

test("listShopifyCatalog maps title image stock", async () => {
  const f = vi.fn().mockResolvedValue(
    ok({
      productVariants: {
        nodes: [cnode(1, "A")],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    })
  )
  expect(await listShopifyCatalog(clientFor(f))).toEqual([
    {
      externalId: "gid://shopify/ProductVariant/1",
      parentExternalId: "gid://shopify/Product/1",
      sku: "A",
      title: "Var 1",
      parentTitle: "Prod",
      price: "9.99",
      stock: 1,
      imageUrl: "http://img/1.jpg",
      currency: null,
      inventoryItemId: "gid://shopify/InventoryItem/1",
    },
  ])
  expect(JSON.parse(f.mock.calls[0][1].body).query).not.toMatch(/mutation/)
  expect(JSON.parse(f.mock.calls[0][1].body).query).toMatch(/inventoryItem\s*\{\s*id\s*\}/)
})

test("listShopifyCatalog blank sku becomes null", async () => {
  const n = { ...cnode(2, ""), product: { id: "p", title: "P", featuredImage: null } }
  const f = vi.fn().mockResolvedValue(
    ok({
      productVariants: {
        nodes: [n],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    })
  )
  const out = await listShopifyCatalog(clientFor(f))
  expect(out[0].sku).toBeNull()
  expect(out[0].imageUrl).toBeNull()
  expect(out[0].inventoryItemId).toBe("gid://shopify/InventoryItem/2")
})

test("listShopifyCatalog paginates", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      ok({
        productVariants: {
          nodes: [cnode(1, "A")],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      })
    )
    .mockResolvedValueOnce(
      ok({
        productVariants: {
          nodes: [cnode(2, "B")],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      })
    )
  const out = await listShopifyCatalog(clientFor(f))
  expect(out).toHaveLength(2)
  expect(JSON.parse(f.mock.calls[1][1].body).variables.after).toBe("c1")
})
