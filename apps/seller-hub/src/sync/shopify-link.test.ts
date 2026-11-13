import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { ShopifyClient } from "../shopify/client.js"
import { linkShopifyVariants } from "./shopify-link.js"

type Listing = Record<string, unknown>
type Job = { sync_type: string; external_id: string; status: string; last_error: string }

const fakePool = () => {
  const listings: Listing[] = []
  const jobs: Job[] = []
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO seller_hub\.channel_listing/i.test(sql)) {
        expect(sql).toMatch(/ON CONFLICT \(integration_account_id, external_sku\) DO NOTHING/)
        const [acct, productId, variantId, sku, extVariant, extItem] = params
        if (listings.some((l) => l.acct === acct && l.external_sku === sku)) {
          return { rowCount: 0, rows: [] }
        }
        listings.push({
          acct,
          medusa_product_id: productId,
          medusa_variant_id: variantId,
          external_sku: sku,
          external_variant_id: extVariant,
          external_inventory_item_id: extItem,
          status: "published",
        })
        return { rowCount: 1, rows: [] }
      }
      if (/INSERT INTO seller_hub\.sync_job/i.test(sql)) {
        expect(sql).toMatch(/ON CONFLICT \(integration_account_id, sync_type, external_id\)\s+DO UPDATE/)
        const [, externalId, lastError] = params as string[]
        const existing = jobs.find((j) => j.external_id === externalId)
        if (existing) existing.last_error = lastError
        else jobs.push({ sync_type: "product", external_id: externalId!, status: "failed", last_error: lastError! })
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, listings, jobs }
}

const sv = (n: number, sku: string | null) => ({
  variantId: `gid://shopify/ProductVariant/${n}`,
  sku,
  inventoryItemId: `gid://shopify/InventoryItem/${n}`,
  price: "1.00",
})

// shopify variants are fetched via client.graphql (Task 2's listShopifyVariants)
const shopifyClientFor = (variants: ReturnType<typeof sv>[]) =>
  ({
    graphql: vi.fn(async () => ({
      productVariants: {
        nodes: variants.map((v) => ({
          id: v.variantId,
          sku: v.sku,
          price: v.price,
          inventoryItem: { id: v.inventoryItemId },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    })),
  }) as unknown as ShopifyClient

const medusaFor = (vs: { variantId: string; productId: string; sku: string }[]) =>
  ({ listVariantsBySku: vi.fn(async () => vs) }) as unknown as MedusaAdminClient

const run = (
  pool: Pool,
  shopify: ReturnType<typeof sv>[],
  medusa: { variantId: string; productId: string; sku: string }[]
) =>
  linkShopifyVariants({
    pool,
    medusaClient: medusaFor(medusa),
    shopifyClient: shopifyClientFor(shopify),
    integrationAccountId: "acct-1",
  })

test("links matching SKUs, then a second run adds nothing", async () => {
  const { pool, listings, jobs } = fakePool()
  const shopify = [sv(1, "A"), sv(2, "B")]
  const medusa = [
    { variantId: "mv1", productId: "mp1", sku: "A" },
    { variantId: "mv2", productId: "mp2", sku: "B" },
  ]
  const first = await run(pool, shopify, medusa)
  expect(first).toEqual({ linked: 2, alreadyLinked: 0, unmatched: [], duplicates: [] })
  expect(listings).toHaveLength(2)
  expect(listings[0]).toEqual({
    acct: "acct-1",
    medusa_product_id: "mp1",
    medusa_variant_id: "mv1",
    external_sku: "A",
    external_variant_id: "gid://shopify/ProductVariant/1",
    external_inventory_item_id: "gid://shopify/InventoryItem/1",
    status: "published",
  })
  const second = await run(pool, shopify, medusa)
  expect(second).toEqual({ linked: 0, alreadyLinked: 2, unmatched: [], duplicates: [] })
  expect(listings).toHaveLength(2)
  expect(jobs).toHaveLength(0)
})

test("unmatched Shopify SKU is reported and recorded, never linked; re-run is an upsert", async () => {
  const { pool, listings, jobs } = fakePool()
  const shopify = [sv(1, "A"), sv(2, "ZZZ")]
  const medusa = [{ variantId: "mv1", productId: "mp1", sku: "A" }]
  const r = await run(pool, shopify, medusa)
  expect(r.unmatched).toEqual(["ZZZ"])
  expect(listings).toHaveLength(1)
  expect(jobs).toEqual([
    { sync_type: "product", external_id: "ZZZ", status: "failed", last_error: expect.any(String) },
  ])
  await run(pool, shopify, medusa)
  expect(jobs).toHaveLength(1)
})

test("a SKU duplicated on either side is reported and not linked", async () => {
  const { pool, listings, jobs } = fakePool()
  const r = await run(
    pool,
    [sv(1, "D1"), sv(2, "D1"), sv(3, "D2"), sv(4, "OK")],
    [
      { variantId: "m1", productId: "p1", sku: "D1" },
      { variantId: "m2", productId: "p2", sku: "D2" },
      { variantId: "m3", productId: "p3", sku: "D2" },
      { variantId: "m4", productId: "p4", sku: "OK" },
    ]
  )
  expect(r.duplicates.sort()).toEqual(["D1", "D2"])
  expect(r.unmatched).toEqual([])
  expect(r.linked).toBe(1)
  expect(listings.map((l) => l.external_sku)).toEqual(["OK"])
  expect(jobs.map((j) => j.external_id).sort()).toEqual(["D1", "D2"])
})

test("blank/null Shopify SKUs are ignored; comparison is case-sensitive after trimming", async () => {
  const { pool, listings } = fakePool()
  const r = await run(
    pool,
    [sv(1, null), sv(2, ""), sv(3, "   "), sv(4, " abc "), sv(5, "Case")],
    [
      { variantId: "m1", productId: "p1", sku: "abc" },
      { variantId: "m2", productId: "p2", sku: "case" },
    ]
  )
  expect(r.linked).toBe(1)
  expect(r.unmatched).toEqual(["Case"])
  expect(listings).toHaveLength(1)
  expect(listings[0]!.external_sku).toBe("abc")
})
