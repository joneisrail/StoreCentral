import { beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { Queue } from "bullmq"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { reconcile, scheduleReconciliation } from "./reconcile.js"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!

let pool: Pool
let medusaClient: MedusaAdminClient
let authHeaders: Record<string, string>
let productId: string
// Dedicated variants (product index 2, variant indices 1-3) so this file's
// reads/writes can't collide with push-inventory.test.ts (same product,
// variant index 0 only) or push-price.test.ts / admin-client.test.ts
// (product indices 0-1).
let inventoryVariantId: string
let noDriftVariantId: string
let priceVariantId: string
let realInventoryQuantity: number

/**
 * Creates a fresh `integration_account` row. Each test below gets its own,
 * rather than sharing one across the file -- `reconcile` scans *every*
 * `channel_listing` row for the given account, so sharing an account would
 * let one test's fixture rows leak into another test's drift count.
 */
const createIntegrationAccount = async (): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  return rows[0]!.id
}

const insertChannelListing = async (opts: {
  accountId: string
  variantId: string
  lastSyncedQuantity?: number | null
  lastSyncedPrice?: number | null
  priceRule?: { type: "percentage" | "fixed"; value: number } | null
}): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status, price_rule, last_synced_quantity, last_synced_price)
     VALUES ($1, $2, $3, $4, 'published', $5, $6, $7)
     RETURNING id`,
    [
      opts.accountId,
      productId,
      opts.variantId,
      "RECONCILE-SKU-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      opts.priceRule ? JSON.stringify(opts.priceRule) : null,
      opts.lastSyncedQuantity ?? null,
      opts.lastSyncedPrice ?? null,
    ]
  )
  return rows[0]!.id
}

const setVariantPrice = async (
  vId: string,
  amount: number,
  currencyCode = "usd"
): Promise<void> => {
  await fetch(`${BASE_URL}/admin/products/${productId}/variants/${vId}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ prices: [{ currency_code: currencyCode, amount }] }),
  })
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

  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=3&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const product = products[2] ?? products[products.length - 1]
  if (!product || product.variants.length < 4) {
    throw new Error("Expected the 3rd demo product to have at least 4 variants.")
  }
  productId = product.id
  inventoryVariantId = product.variants[1]!.id
  noDriftVariantId = product.variants[2]!.id
  priceVariantId = product.variants[3]!.id

  const inventory = await medusaClient.getVariantInventory(inventoryVariantId)
  realInventoryQuantity = inventory.quantity
}, 30_000)

test("reconcile enqueues an inventory-sync job when Medusa's stock differs from last_synced_quantity", async () => {
  const accountId = await createIntegrationAccount()
  await insertChannelListing({
    accountId,
    variantId: inventoryVariantId,
    lastSyncedQuantity: realInventoryQuantity + 3,
  })
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  const result = await reconcile({
    pool,
    medusaClient,
    integrationAccountId: accountId,
    inventoryQueue,
    priceQueue,
  })

  expect(result.driftFound).toBeGreaterThanOrEqual(1)
  expect(inventoryQueue.add).toHaveBeenCalled()
})

test("reconcile finds no drift and enqueues nothing when values match", async () => {
  const accountId = await createIntegrationAccount()
  const inventory = await medusaClient.getVariantInventory(noDriftVariantId)
  await setVariantPrice(noDriftVariantId, 15)
  const pricing = await medusaClient.getVariantPricing(noDriftVariantId)
  await insertChannelListing({
    accountId,
    variantId: noDriftVariantId,
    lastSyncedQuantity: inventory.quantity,
    lastSyncedPrice: pricing.amount,
  })
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  const result = await reconcile({
    pool,
    medusaClient,
    integrationAccountId: accountId,
    inventoryQueue,
    priceQueue,
  })

  expect(result.driftFound).toBe(0)
  expect(inventoryQueue.add).not.toHaveBeenCalled()
  expect(priceQueue.add).not.toHaveBeenCalled()
})

test("reconcile enqueues a price-sync job when Medusa's price (after price_rule) differs from last_synced_price", async () => {
  const accountId = await createIntegrationAccount()
  await setVariantPrice(priceVariantId, 29.99)
  await insertChannelListing({
    accountId,
    variantId: priceVariantId,
    lastSyncedPrice: 32.99, // stale: was 29.99 * 1.10 before Medusa's price changed
    priceRule: { type: "percentage", value: 10 },
  })
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  // Change Medusa's price after the "last synced" snapshot was taken, so
  // the current (rule-applied) price no longer matches last_synced_price.
  await setVariantPrice(priceVariantId, 40)

  const result = await reconcile({
    pool,
    medusaClient,
    integrationAccountId: accountId,
    inventoryQueue,
    priceQueue,
  })

  expect(result.driftFound).toBeGreaterThanOrEqual(1)
  expect(priceQueue.add).toHaveBeenCalled()
  expect(inventoryQueue.add).not.toHaveBeenCalled()
})

test("reconcile skips a listing that has never been synced (no baseline to compare)", async () => {
  const accountId = await createIntegrationAccount()
  await insertChannelListing({
    accountId,
    variantId: inventoryVariantId,
  })
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue

  const result = await reconcile({
    pool,
    medusaClient,
    integrationAccountId: accountId,
    inventoryQueue,
    priceQueue,
  })

  expect(result.driftFound).toBe(0)
  expect(inventoryQueue.add).not.toHaveBeenCalled()
  expect(priceQueue.add).not.toHaveBeenCalled()
})

test("scheduleReconciliation adds a repeatable job to the given queue", async () => {
  const queue = { add: vi.fn() } as unknown as Queue

  await scheduleReconciliation(queue, 60_000)

  expect(queue.add).toHaveBeenCalledWith(
    "reconcile",
    {},
    { repeat: { every: 60_000 } }
  )
})
