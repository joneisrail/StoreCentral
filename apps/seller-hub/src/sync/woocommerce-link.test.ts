import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { WooCommerceClient } from "../woocommerce/client.js"
import { linkWooCommerceListings } from "./woocommerce-link.js"

type Listing = Record<string, unknown>
type Job = { sync_type: string; external_id: string; status: string; last_error: string }

const fakePool = () => {
  const listings: Listing[] = []
  const jobs: Job[] = []
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO seller_hub\.channel_listing/i.test(sql)) {
        expect(sql).toMatch(/ON CONFLICT \(integration_account_id, external_sku\) DO NOTHING/)
        const [acct, productId, variantId, sku, extVariant, extParent] = params
        if (listings.some((l) => l.acct === acct && l.external_sku === sku)) {
          return { rowCount: 0, rows: [] }
        }
        listings.push({
          acct,
          medusa_product_id: productId,
          medusa_variant_id: variantId,
          external_sku: sku,
          external_variant_id: extVariant,
          external_parent_id: extParent,
          status: "published",
        })
        return { rowCount: 1, rows: [] }
      }
      if (/INSERT INTO seller_hub\.sync_job/i.test(sql)) {
        expect(sql).toMatch(/ON CONFLICT \(integration_account_id, sync_type, external_id\)\s+DO UPDATE/)
        const [, externalId, lastError] = params as string[]
        const existing = jobs.find((j) => j.external_id === externalId)
        if (existing) existing.last_error = lastError!
        else jobs.push({ sync_type: "product", external_id: externalId!, status: "failed", last_error: lastError! })
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, listings, jobs }
}

type Woo = { id: number; parentId: number | null; sku: string; price: string }
const wl = (id: number, sku: string, parentId: number | null = null): Woo => ({
  id,
  parentId,
  sku,
  price: "1.00",
})

// listWooListings reads through the client; stub the underlying products/variations calls
vi.mock("../woocommerce/products.js", () => ({
  listWooListings: vi.fn(async (c: { __listings: Woo[] }) => c.__listings),
}))

const wooFor = (l: Woo[]) => ({ __listings: l }) as unknown as WooCommerceClient
const medusaFor = (vs: { variantId: string; productId: string; sku: string }[]) =>
  ({ listVariantsBySku: vi.fn(async () => vs) }) as unknown as MedusaAdminClient

const run = (
  pool: Pool,
  woo: Woo[],
  medusa: { variantId: string; productId: string; sku: string }[]
) =>
  linkWooCommerceListings({
    pool,
    medusaClient: medusaFor(medusa),
    wooClient: wooFor(woo),
    integrationAccountId: "acct-1",
  })

test("links simple and variation listings (ids as strings, parent stored), re-run adds nothing", async () => {
  const { pool, listings, jobs } = fakePool()
  const woo = [wl(10, "A"), wl(21, "B", 20)]
  const medusa = [
    { variantId: "mv1", productId: "mp1", sku: "A" },
    { variantId: "mv2", productId: "mp2", sku: "B" },
  ]
  expect(await run(pool, woo, medusa)).toEqual({ linked: 2, alreadyLinked: 0, unmatched: [], duplicates: [] })
  expect(listings[0]).toEqual({
    acct: "acct-1",
    medusa_product_id: "mp1",
    medusa_variant_id: "mv1",
    external_sku: "A",
    external_variant_id: "10",
    external_parent_id: null,
    status: "published",
  })
  expect(listings[1]).toMatchObject({ external_variant_id: "21", external_parent_id: "20" })
  expect(await run(pool, woo, medusa)).toEqual({ linked: 0, alreadyLinked: 2, unmatched: [], duplicates: [] })
  expect(listings).toHaveLength(2)
  expect(jobs).toHaveLength(0)
})

test("unmatched WooCommerce SKU is reported and recorded, never linked; re-run is an upsert", async () => {
  const { pool, listings, jobs } = fakePool()
  const woo = [wl(1, "A"), wl(2, "ZZZ")]
  const medusa = [{ variantId: "mv1", productId: "mp1", sku: "A" }]
  const r = await run(pool, woo, medusa)
  expect(r.unmatched).toEqual(["ZZZ"])
  expect(listings).toHaveLength(1)
  expect(jobs).toEqual([
    { sync_type: "product", external_id: "ZZZ", status: "failed", last_error: expect.any(String) },
  ])
  await run(pool, woo, medusa)
  expect(jobs).toHaveLength(1)
})

test("a SKU duplicated on either side is reported and not linked", async () => {
  const { pool, listings, jobs } = fakePool()
  const r = await run(
    pool,
    [wl(1, "D1"), wl(2, "D1", 9), wl(3, "D2"), wl(4, "OK")],
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

test("blank SKUs are ignored; comparison is case-sensitive after trimming", async () => {
  const { pool, listings } = fakePool()
  const r = await run(
    pool,
    [wl(2, ""), wl(3, "   "), wl(4, " abc "), wl(5, "Case")],
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
