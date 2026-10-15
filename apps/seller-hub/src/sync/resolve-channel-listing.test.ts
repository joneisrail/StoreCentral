import { beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { PermanentSyncError } from "../queue/queues.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import {
  resolveInventoryChannelListingId,
  resolvePriceChannelListingId,
} from "./resolve-channel-listing.js"

let pool: Pool
let integrationAccountId: string
const productId = "prod_resolve_channel_listing_fixture"

const createIntegrationAccount = async (): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  return rows[0]!.id
}

const insertChannelListing = async (
  accountId: string,
  variantId: string
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status)
     VALUES ($1, $2, $3, $4, 'published')
     RETURNING id`,
    [
      accountId,
      productId,
      variantId,
      "RESOLVE-SKU-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    ]
  )
  return rows[0]!.id
}

const fakeMedusaClient = (
  findVariantIdByInventoryLevelId: (id: string) => Promise<string | null>
) =>
  ({
    findVariantIdByInventoryLevelId: vi.fn(findVariantIdByInventoryLevelId),
  }) as unknown as MedusaAdminClient

beforeAll(async () => {
  const env = loadEnv()
  pool = createPool(env)
  await runMigrations(pool)
  integrationAccountId = await createIntegrationAccount()
}, 30_000)

test("resolveInventoryChannelListingId passes a channelListingId through unchanged, without calling Medusa", async () => {
  const medusaClient = fakeMedusaClient(async () => {
    throw new Error("should not be called")
  })

  const result = await resolveInventoryChannelListingId(
    { channelListingId: "cl_direct" },
    { pool, medusaClient, integrationAccountId }
  )

  expect(result).toBe("cl_direct")
})

test("resolveInventoryChannelListingId resolves an inventoryLevelId via the variant it belongs to", async () => {
  const variantId = "variant_" + Date.now()
  const channelListingId = await insertChannelListing(
    integrationAccountId,
    variantId
  )
  const medusaClient = fakeMedusaClient(async (levelId) => {
    expect(levelId).toBe("ilev_123")
    return variantId
  })

  const result = await resolveInventoryChannelListingId(
    { inventoryLevelId: "ilev_123" },
    { pool, medusaClient, integrationAccountId }
  )

  expect(result).toBe(channelListingId)
})

test("resolveInventoryChannelListingId throws PermanentSyncError when the inventory level has no owning variant", async () => {
  const medusaClient = fakeMedusaClient(async () => null)

  await expect(
    resolveInventoryChannelListingId(
      { inventoryLevelId: "ilev_unmapped" },
      { pool, medusaClient, integrationAccountId }
    )
  ).rejects.toThrow(PermanentSyncError)
})

test("resolveInventoryChannelListingId throws PermanentSyncError when the resolved variant has no channel_listing mapping", async () => {
  const medusaClient = fakeMedusaClient(async () => "variant_unmapped_" + Date.now())

  await expect(
    resolveInventoryChannelListingId(
      { inventoryLevelId: "ilev_456" },
      { pool, medusaClient, integrationAccountId }
    )
  ).rejects.toThrow(PermanentSyncError)
})

test("resolvePriceChannelListingId passes a channelListingId through unchanged", async () => {
  const medusaClient = fakeMedusaClient(async () => {
    throw new Error("should not be called")
  })

  const result = await resolvePriceChannelListingId(
    { channelListingId: "cl_direct_price" },
    { pool, medusaClient, integrationAccountId }
  )

  expect(result).toBe("cl_direct_price")
})

test("resolvePriceChannelListingId resolves a variantId directly against channel_listing", async () => {
  const variantId = "variant_price_" + Date.now()
  const channelListingId = await insertChannelListing(
    integrationAccountId,
    variantId
  )
  const medusaClient = fakeMedusaClient(async () => {
    throw new Error("should not be called for price resolution")
  })

  const result = await resolvePriceChannelListingId(
    { variantId },
    { pool, medusaClient, integrationAccountId }
  )

  expect(result).toBe(channelListingId)
})

test("resolvePriceChannelListingId throws PermanentSyncError when the variant has no channel_listing mapping", async () => {
  const medusaClient = fakeMedusaClient(async () => {
    throw new Error("should not be called for price resolution")
  })

  await expect(
    resolvePriceChannelListingId(
      { variantId: "variant_unmapped_price_" + Date.now() },
      { pool, medusaClient, integrationAccountId }
    )
  ).rejects.toThrow(PermanentSyncError)
})
