import { beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { Queue } from "bullmq"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { SpApiClient } from "../sp-api/client.js"
import { processInventorySyncJob } from "./inventory-sync-processor.js"

let pool: Pool
let integrationAccountId: string
const productId = "prod_inventory_sync_processor_fixture"

const createIntegrationAccount = async (): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  return rows[0]!.id
}

const insertChannelListing = async (variantId: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, external_asin, status)
     VALUES ($1, $2, $3, $4, $5, 'published')
     RETURNING id`,
    [
      integrationAccountId,
      productId,
      variantId,
      "INV-PROC-SKU-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      "B00TESTPROC",
    ]
  )
  return rows[0]!.id
}

const fakeMedusaClient = (
  overrides: {
    findVariantIdByInventoryLevelId?: (id: string) => Promise<string | null>
  } = {}
) =>
  ({
    getVariantInventory: vi.fn().mockResolvedValue({ quantity: 7 }),
    getVariantPricing: vi.fn().mockResolvedValue({ amount: 0, currencyCode: "usd" }),
    findVariantIdByInventoryLevelId: vi.fn(
      overrides.findVariantIdByInventoryLevelId ?? (async () => null)
    ),
  }) as unknown as MedusaAdminClient

const fakeSpApiClient = () =>
  ({ request: vi.fn().mockResolvedValue({}) }) as unknown as SpApiClient

beforeAll(async () => {
  const env = loadEnv()
  pool = createPool(env)
  await runMigrations(pool)
  integrationAccountId = await createIntegrationAccount()
}, 30_000)

test("an empty-payload job runs a full reconcile scan, not a push to Amazon", async () => {
  const variantId = "variant_scan_" + Date.now()
  const channelListingId = await insertChannelListing(variantId)
  // A stale last_synced_quantity vs. the fake's real-time reading (7) below
  // creates drift for `reconcile()` to find.
  await pool.query(
    `UPDATE seller_hub.channel_listing SET last_synced_quantity = $1 WHERE id = $2`,
    [999, channelListingId]
  )

  const medusaClient = fakeMedusaClient()
  const spApiClient = fakeSpApiClient()
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  await processInventorySyncJob(
    {},
    {
      pool,
      medusaClient,
      spApiClient,
      integrationAccountId,
      inventoryQueue,
      priceQueue,
    }
  )

  // The scan found the drift and enqueued a corrective job...
  expect(inventoryQueue.add).toHaveBeenCalledWith("reconcile", {
    channelListingId,
  })
  // ...instead of pushing straight to Amazon for the empty-payload job
  // itself.
  expect(spApiClient.request).not.toHaveBeenCalled()
})

test("a corrective {channelListingId} job (also named \"reconcile\") pushes directly to Amazon and does not re-trigger a scan", async () => {
  const variantId = "variant_push_" + Date.now()
  const channelListingId = await insertChannelListing(variantId)

  const medusaClient = fakeMedusaClient()
  const spApiClient = fakeSpApiClient()
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  await processInventorySyncJob(
    { channelListingId },
    {
      pool,
      medusaClient,
      spApiClient,
      integrationAccountId,
      inventoryQueue,
      priceQueue,
    }
  )

  // Pushed to Amazon directly...
  expect(spApiClient.request).toHaveBeenCalledTimes(1)
  // ...and never ran a full scan (which would have enqueued onto these
  // queues for any other drifted listing, including a re-enqueue of this
  // exact job -- the infinite-loop failure mode this test guards against).
  expect(inventoryQueue.add).not.toHaveBeenCalled()
  expect(priceQueue.add).not.toHaveBeenCalled()

  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'inventory' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows[0]?.status).toBe("succeeded")
})

test("an {inventoryLevelId} job (webhook flow) resolves through Medusa before pushing to Amazon", async () => {
  const variantId = "variant_level_" + Date.now()
  const channelListingId = await insertChannelListing(variantId)
  const inventoryLevelId = "ilev_fake_" + Date.now()

  const medusaClient = fakeMedusaClient({
    findVariantIdByInventoryLevelId: async (id) => {
      expect(id).toBe(inventoryLevelId)
      return variantId
    },
  })
  const spApiClient = fakeSpApiClient()
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  await processInventorySyncJob(
    { inventoryLevelId },
    {
      pool,
      medusaClient,
      spApiClient,
      integrationAccountId,
      inventoryQueue,
      priceQueue,
    }
  )

  expect(spApiClient.request).toHaveBeenCalledTimes(1)
  expect(inventoryQueue.add).not.toHaveBeenCalled()

  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'inventory' AND external_id = $2`,
    [integrationAccountId, channelListingId]
  )
  expect(rows[0]?.status).toBe("succeeded")
})
