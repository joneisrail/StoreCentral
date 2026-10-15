import { beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import { pushInventoryUpdate } from "./push-inventory.js"
import type { SpApiClient } from "../sp-api/client.js"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!

let pool: Pool
let medusaClient: MedusaAdminClient
let authHeaders: Record<string, string>
let integrationAccountId: string
let productId: string
let variantId: string
let realInventoryQuantity: number

const makeFakeSpApiClient = () => ({ request: vi.fn() })

const insertChannelListing = async (externalAsin?: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, external_asin, status)
     VALUES ($1, $2, $3, $4, $5, 'published')
     RETURNING id`,
    [
      integrationAccountId,
      productId,
      variantId,
      "PUSH-INVENTORY-SKU-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2),
      externalAsin ?? null,
    ]
  )
  return rows[0]!.id
}

beforeAll(async () => {
  const env = loadEnv()
  pool = createPool(env)
  await runMigrations(pool)

  medusaClient = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  await medusaClient.login()

  const loginResponse = await fetch(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const { token } = (await loginResponse.json()) as { token: string }
  authHeaders = { Authorization: `Bearer ${token}` }

  // The 3rd product in the demo catalog, dedicated to this file, so this
  // suite's assertions can't be affected by other test files reading or
  // mutating the 1st/2nd product's variants.
  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=3&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const product = products[2] ?? products[products.length - 1]
  const variant = product?.variants?.[0]
  if (!product || !variant) {
    throw new Error("No product/variant found in the demo catalog.")
  }
  productId = product.id
  variantId = variant.id

  // Real current stock, read the same way the implementation under test
  // will read it, so the assertions below aren't a hardcoded guess about
  // what the demo catalog happens to seed.
  const inventory = await medusaClient.getVariantInventory(variantId)
  realInventoryQuantity = inventory.quantity

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  integrationAccountId = accountResult.rows[0]!.id
}, 30_000)

test("pushInventoryUpdate submits the real Medusa stock quantity via submitListingFeed and marks sync_job succeeded", async () => {
  const channelListingId = await insertChannelListing("B00TESTASIN1")
  const fakeSpApiClient = makeFakeSpApiClient()

  await pushInventoryUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  expect(fakeSpApiClient.request).toHaveBeenCalledTimes(1)
  const call = fakeSpApiClient.request.mock.calls[0][0]
  expect(call.name).toBe("submitListingFeed")
  expect(call.method).toBe("POST")
  expect(call.body).toEqual(
    expect.objectContaining({
      feedType: "POST_PRODUCT_DATA",
      asin: "B00TESTASIN1",
      attributes: expect.objectContaining({ quantity: realInventoryQuantity }),
    })
  )

  const { rows } = await pool.query(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'inventory' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe("succeeded")
  expect(rows[0].last_error).toBeNull()

  const { rows: listingRows } = await pool.query(
    `SELECT last_synced_quantity FROM seller_hub.channel_listing WHERE id = $1`,
    [channelListingId]
  )
  expect(listingRows[0].last_synced_quantity).toBe(realInventoryQuantity)
})

test("pushInventoryUpdate works without an external_asin (sku-only listing)", async () => {
  const channelListingId = await insertChannelListing(undefined)
  const fakeSpApiClient = makeFakeSpApiClient()

  await pushInventoryUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  const call = fakeSpApiClient.request.mock.calls[0][0]
  expect(call.body.asin).toBeUndefined()
})

test("pushInventoryUpdate marks sync_job failed (no retry) on a permanent SP-API rejection", async () => {
  const channelListingId = await insertChannelListing("B00TESTASIN2")
  const fakeSpApiClient = {
    request: vi.fn().mockRejectedValue(new Error("400: invalid sku")),
  }

  await expect(
    pushInventoryUpdate({
      pool,
      medusaClient,
      spApiClient: fakeSpApiClient as unknown as SpApiClient,
      integrationAccountId,
      channelListingId,
    })
  ).rejects.toThrow(PermanentSyncError)

  const { rows } = await pool.query(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'inventory' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows[0].status).toBe("failed")
  expect(rows[0].last_error).toContain("400: invalid sku")
})

test("pushInventoryUpdate rethrows the original error for a transient SP-API failure, so the worker retries", async () => {
  const channelListingId = await insertChannelListing("B00TESTASIN3")
  const fakeSpApiClient = {
    request: vi.fn().mockRejectedValue(new Error("500: internal error")),
  }

  const rejection = pushInventoryUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  await expect(rejection).rejects.toThrow(/500/)
  await expect(rejection).rejects.not.toBeInstanceOf(PermanentSyncError)
})

test("pushInventoryUpdate rethrows the original error (not PermanentSyncError) for a 429, so the worker retries instead of treating throttling as permanent", async () => {
  const channelListingId = await insertChannelListing("B00TESTASIN4")
  const fakeSpApiClient = {
    request: vi.fn().mockRejectedValue(new Error("429: rate limited")),
  }

  const rejection = pushInventoryUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  await expect(rejection).rejects.toThrow(/429/)
  await expect(rejection).rejects.not.toBeInstanceOf(PermanentSyncError)
})
