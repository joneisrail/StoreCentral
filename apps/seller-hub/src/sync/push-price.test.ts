import { beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import { pushPriceUpdate } from "./push-price.js"
import type { SpApiClient } from "../sp-api/client.js"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!

let pool: Pool
let medusaClient: MedusaAdminClient
let authHeaders: Record<string, string>
let integrationAccountId: string
let variantId: string
let productId: string

type FakeSpApiClient = { request: ReturnType<typeof vi.fn> }

const makeFakeSpApiClient = (): FakeSpApiClient => ({ request: vi.fn() })

/** Sets a known, single price for a variant on the real backend. */
const setVariantPrice = async (
  pId: string,
  vId: string,
  amount: number,
  currencyCode = "usd"
): Promise<void> => {
  await fetch(`${BASE_URL}/admin/products/${pId}/variants/${vId}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ prices: [{ currency_code: currencyCode, amount }] }),
  })
}

const insertChannelListing = async (
  priceRule: { type: "percentage" | "fixed"; value: number } | null
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status, price_rule)
     VALUES ($1, $2, $3, $4, 'published', $5)
     RETURNING id`,
    [
      integrationAccountId,
      productId,
      variantId,
      "PUSH-PRICE-SKU-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      priceRule ? JSON.stringify(priceRule) : null,
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

  // A dedicated product/variant (the 2nd in the demo catalog) so this
  // file's price mutations can't collide with other test files' fixtures
  // that use the 1st product/variant (e.g. import-order.test.ts,
  // admin-client.test.ts's order tests).
  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=2&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const product = products[1] ?? products[0]
  const variant = product?.variants?.[0]
  if (!product || !variant) {
    throw new Error("No product/variant found in the demo catalog.")
  }
  productId = product.id
  variantId = variant.id

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  integrationAccountId = accountResult.rows[0]!.id
}, 30_000)

test("pushPriceUpdate applies a percentage markup from channel_listing.price_rule before submitting", async () => {
  await setVariantPrice(productId, variantId, 29.99)
  const channelListingId = await insertChannelListing({
    type: "percentage",
    value: 10,
  })
  const fakeSpApiClient = makeFakeSpApiClient()

  await pushPriceUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  expect(fakeSpApiClient.request).toHaveBeenCalledTimes(1)
  const call = fakeSpApiClient.request.mock.calls[0][0]
  expect(call.name).toBe("submitPriceUpdate")
  expect(call.method).toBe("POST")
  expect(call.body).toEqual(
    expect.objectContaining({
      feedType: "POST_PRODUCT_PRICING_DATA",
      amount: 32.99, // 29.99 * 1.10, rounded to 2 decimals
      currencyCode: "usd",
    })
  )

  const { rows } = await pool.query(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'price' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe("succeeded")
  expect(rows[0].last_error).toBeNull()
})

test("pushPriceUpdate applies a fixed price override from channel_listing.price_rule", async () => {
  await setVariantPrice(productId, variantId, 50)
  const channelListingId = await insertChannelListing({
    type: "fixed",
    value: 24.5,
  })
  const fakeSpApiClient = makeFakeSpApiClient()

  await pushPriceUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  const call = fakeSpApiClient.request.mock.calls[0][0]
  expect(call.body).toEqual(
    expect.objectContaining({ amount: 24.5, currencyCode: "usd" })
  )
})

test("pushPriceUpdate marks sync_job failed (no retry) on a permanent SP-API rejection", async () => {
  await setVariantPrice(productId, variantId, 10)
  const channelListingId = await insertChannelListing({
    type: "percentage",
    value: 5,
  })
  const fakeSpApiClient = {
    request: vi.fn().mockRejectedValue(new Error("400: invalid price")),
  }

  await expect(
    pushPriceUpdate({
      pool,
      medusaClient,
      spApiClient: fakeSpApiClient as unknown as SpApiClient,
      integrationAccountId,
      channelListingId,
    })
  ).rejects.toThrow(PermanentSyncError)

  const { rows } = await pool.query(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'price' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe("failed")
  expect(rows[0].last_error).toContain("400: invalid price")
})

test("pushPriceUpdate rethrows the original error (not PermanentSyncError) for a transient failure, so the worker retries", async () => {
  await setVariantPrice(productId, variantId, 10)
  const channelListingId = await insertChannelListing({
    type: "percentage",
    value: 5,
  })
  const fakeSpApiClient = {
    request: vi
      .fn()
      .mockRejectedValue(new Error("503: service temporarily unavailable")),
  }

  const rejection = pushPriceUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  await expect(rejection).rejects.toThrow(/503/)
  await expect(rejection).rejects.not.toBeInstanceOf(PermanentSyncError)

  const { rows } = await pool.query(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'price' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows[0].status).toBe("failed")
  expect(rows[0].last_error).toContain("503")
})

test("pushPriceUpdate rethrows the original error (not PermanentSyncError) for a 429, so the worker retries instead of treating throttling as permanent", async () => {
  await setVariantPrice(productId, variantId, 10)
  const channelListingId = await insertChannelListing({
    type: "percentage",
    value: 5,
  })
  const fakeSpApiClient = {
    request: vi.fn().mockRejectedValue(new Error("429: rate limited")),
  }

  const rejection = pushPriceUpdate({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  await expect(rejection).rejects.toThrow(/429/)
  await expect(rejection).rejects.not.toBeInstanceOf(PermanentSyncError)

  const { rows } = await pool.query(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'price' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows[0].status).toBe("failed")
  expect(rows[0].last_error).toContain("429")
})

test("pushPriceUpdate throws a PermanentSyncError when the channel_listing row doesn't exist", async () => {
  const fakeSpApiClient = makeFakeSpApiClient()

  await expect(
    pushPriceUpdate({
      pool,
      medusaClient,
      spApiClient: fakeSpApiClient as unknown as SpApiClient,
      integrationAccountId,
      channelListingId: "00000000-0000-0000-0000-000000000000",
    })
  ).rejects.toThrow(PermanentSyncError)

  expect(fakeSpApiClient.request).not.toHaveBeenCalled()
})
