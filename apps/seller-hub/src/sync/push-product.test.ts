import { beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import { pushProductListing } from "./push-product.js"
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

const insertChannelListing = async (): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, external_asin, status)
     VALUES ($1, $2, $3, $4, 'B00PRODTEST1', 'draft')
     RETURNING id`,
    [
      integrationAccountId,
      productId,
      variantId,
      "PUSH-PRODUCT-SKU-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2),
    ]
  )
  return rows[0]!.id
}

const getChannelListing = async (
  channelListingId: string
): Promise<{ status: string; last_error: string | null }> => {
  const { rows } = await pool.query<{ status: string; last_error: string | null }>(
    `SELECT status, last_error FROM seller_hub.channel_listing WHERE id = $1`,
    [channelListingId]
  )
  return rows[0]!
}

const getSyncJob = async (
  channelListingId: string
): Promise<{ status: string; last_error: string | null }> => {
  const { rows } = await pool.query<{ status: string; last_error: string | null }>(
    `SELECT status, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'product' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  return rows[0]!
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

  // The 4th product in the demo catalog, dedicated to this file.
  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=4&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const product = products[3] ?? products[products.length - 1]
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

test("pushProductListing moves draft -> pending (before submitting) -> published when the feed completes DONE", async () => {
  const channelListingId = await insertChannelListing()
  const before = await getChannelListing(channelListingId)
  expect(before.status).toBe("draft")

  const fakeSpApiClient = {
    request: vi.fn().mockImplementation(async (operation: { name: string }) => {
      if (operation.name === "submitListingFeed") {
        // Assert the *actual sequencing*, not just that this was called:
        // channel_listing must already be 'pending' in Postgres by the time
        // the feed is submitted to Amazon, i.e. the draft -> pending move
        // happens before submission, not after.
        const current = await getChannelListing(channelListingId)
        expect(current.status).toBe("pending")
        return { feedId: "FEED-DONE-1" }
      }
      if (operation.name === "getFeedResult") {
        return { status: "DONE" }
      }
      throw new Error(`unexpected operation: ${operation.name}`)
    }),
  }

  await pushProductListing({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  const after = await getChannelListing(channelListingId)
  expect(after.status).toBe("published")
  expect(after.last_error).toBeNull()

  const submitCall = fakeSpApiClient.request.mock.calls.find(
    (c) => c[0].name === "submitListingFeed"
  )![0]
  expect(submitCall.body).toEqual(
    expect.objectContaining({ feedType: "POST_PRODUCT_DATA", asin: "B00PRODTEST1" })
  )

  const syncJob = await getSyncJob(channelListingId)
  expect(syncJob.status).toBe("succeeded")
  expect(syncJob.last_error).toBeNull()
})

test("pushProductListing polls getFeedResult until it stops being IN_PROGRESS", async () => {
  const channelListingId = await insertChannelListing()
  let getFeedResultCalls = 0

  const fakeSpApiClient = {
    request: vi.fn().mockImplementation(async (operation: { name: string }) => {
      if (operation.name === "submitListingFeed") {
        return { feedId: "FEED-POLL-1" }
      }
      if (operation.name === "getFeedResult") {
        getFeedResultCalls += 1
        if (getFeedResultCalls < 3) {
          return { status: "IN_PROGRESS" }
        }
        return { status: "DONE" }
      }
      throw new Error(`unexpected operation: ${operation.name}`)
    }),
  }

  await pushProductListing({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  expect(getFeedResultCalls).toBe(3)
  const after = await getChannelListing(channelListingId)
  expect(after.status).toBe("published")
})

test("pushProductListing lands on rejected with last_error set from the feed's errors when the feed ends FATAL", async () => {
  const channelListingId = await insertChannelListing()

  const fakeSpApiClient = {
    request: vi.fn().mockImplementation(async (operation: { name: string }) => {
      if (operation.name === "submitListingFeed") {
        return { feedId: "FEED-FATAL-1" }
      }
      if (operation.name === "getFeedResult") {
        return {
          status: "FATAL",
          errors: ["Invalid value for attribute 'brand'"],
        }
      }
      throw new Error(`unexpected operation: ${operation.name}`)
    }),
  }

  await expect(
    pushProductListing({
      pool,
      medusaClient,
      spApiClient: fakeSpApiClient as unknown as SpApiClient,
      integrationAccountId,
      channelListingId,
    })
  ).rejects.toThrow(PermanentSyncError)

  const after = await getChannelListing(channelListingId)
  expect(after.status).toBe("rejected")
  expect(after.last_error).toContain("Invalid value for attribute 'brand'")

  const syncJob = await getSyncJob(channelListingId)
  expect(syncJob.status).toBe("failed")
  expect(syncJob.last_error).toContain("Invalid value for attribute 'brand'")
})

test("pushProductListing lands on rejected when the feed is CANCELLED", async () => {
  const channelListingId = await insertChannelListing()

  const fakeSpApiClient = {
    request: vi.fn().mockImplementation(async (operation: { name: string }) => {
      if (operation.name === "submitListingFeed") {
        return { feedId: "FEED-CANCELLED-1" }
      }
      if (operation.name === "getFeedResult") {
        return { status: "CANCELLED" }
      }
      throw new Error(`unexpected operation: ${operation.name}`)
    }),
  }

  await expect(
    pushProductListing({
      pool,
      medusaClient,
      spApiClient: fakeSpApiClient as unknown as SpApiClient,
      integrationAccountId,
      channelListingId,
    })
  ).rejects.toThrow(PermanentSyncError)

  const after = await getChannelListing(channelListingId)
  expect(after.status).toBe("rejected")
})

test("pushProductListing rethrows the original error (not PermanentSyncError) when submitListingFeed fails transiently, so the worker retries", async () => {
  const channelListingId = await insertChannelListing()

  const fakeSpApiClient = {
    request: vi.fn().mockRejectedValue(new Error("500: internal error")),
  }

  const rejection = pushProductListing({
    pool,
    medusaClient,
    spApiClient: fakeSpApiClient as unknown as SpApiClient,
    integrationAccountId,
    channelListingId,
  })

  await expect(rejection).rejects.toThrow(/500/)
  await expect(rejection).rejects.not.toBeInstanceOf(PermanentSyncError)

  // Moved to 'pending' before the failed submission attempt, and stays
  // there (not forced to 'rejected') since this is a transient failure the
  // worker will retry, not a terminal feed outcome.
  const after = await getChannelListing(channelListingId)
  expect(after.status).toBe("pending")

  const syncJob = await getSyncJob(channelListingId)
  expect(syncJob.status).toBe("failed")
})
