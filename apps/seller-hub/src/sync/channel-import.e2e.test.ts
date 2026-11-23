import type { Redis as IORedis } from "ioredis"
import { Pool } from "pg"
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { startFakeMedusa, type FakeMedusa } from "../test-support/fake-medusa.js"
import {
  startWooCommerce,
  type StartWooCommerceDeps,
  type WooCommerceRuntime,
} from "../woocommerce/bootstrap.js"

// End to end for the channel product import: real WooCommerce runtime and
// client (injected fetchImpl), real HTTP fake Medusa, the guarded test
// database. Proves preview, selected import, re-preview, and that the channel
// only ever received GET requests. The in-memory pool of the WooCommerce e2e
// cannot run the importer's SQL, so the real test database is used instead.
// Not covered: a Shopify variant of the no-write assertion.

const config = {
  siteUrl: "https://shop.example.com",
  consumerKey: "ck_test_key",
  consumerSecret: "cs_test_secret",
  webhookSecret: "whsec_test",
}

const noop = async () => {}
const fakeQueue = () => ({ add: noop, close: noop, removeRepeatable: noop })

const makeWoo = () => {
  const requests: { method: string; path: string }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const method = init.method ?? "GET"
    const path = u.pathname.replace("/wp-json/wc/v3", "")
    requests.push({ method, path })
    if (method === "GET" && path === "/products") {
      return new Response(
        JSON.stringify([
          { id: 1, type: "simple", name: "Existing", sku: "E2E-EXISTING", regular_price: "5.00" },
          { id: 2, type: "simple", name: "Mug", sku: "E2E-MUG", regular_price: "9.50", manage_stock: true, stock_quantity: 4 },
          { id: 3, type: "simple", name: "Cap", sku: "E2E-CAP", regular_price: "7.00" },
          { id: 4, type: "simple", name: "No sku", sku: "" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json", "X-WP-TotalPages": "1" } }
      )
    }
    throw new Error(`unexpected WooCommerce request: ${method} ${url}`)
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

let pool: Pool
let fake: FakeMedusa | null = null
let runtime: WooCommerceRuntime | null = null

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return
  pool = new Pool({ connectionString: assertTestDatabase(process.env.TEST_DATABASE_URL) })
  await runMigrations(pool)
}, 30_000)

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  await fake?.close()
  fake = null
  vi.restoreAllMocks()
})

afterAll(async () => {
  await pool?.end()
})

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "preview, import selected SKUs, re-preview, and no write reaches the channel",
  async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO seller_hub.integration_account (marketplace, status)
       VALUES ('woocommerce', 'connected') RETURNING id`
    )
    const accountId = rows[0]!.id
    fake = await startFakeMedusa({
      variants: [
        {
          id: "var_existing",
          product_id: "prod_existing",
          sku: "E2E-EXISTING",
          price: 5,
          currency_code: "usd",
          inventory_quantity: 0,
          inventory_item_id: "ii_existing",
          inventory_level_id: "il_existing",
        },
      ],
    })
    const woo = makeWoo()
    const medusaClient = new MedusaAdminClient({
      baseUrl: fake.baseUrl,
      email: "admin@test",
      password: "pw",
    })
    runtime = await startWooCommerce({
      config,
      pool,
      medusaClient,
      encryptionKey: "00".repeat(32),
      redisConnection: {} as IORedis,
      reconcileIntervalMs: 3_600_000,
      fetchImpl: woo.fetchImpl,
      sleep: noop,
      accountId,
      createQueue: (() => fakeQueue()) as unknown as StartWooCommerceDeps["createQueue"],
      createWorker: (() => ({ close: noop })) as unknown as StartWooCommerceDeps["createWorker"],
    })
    await runtime.linked

    const first = await runtime.previewImport()
    expect(first.matched.map((l) => l.sku)).toEqual(["E2E-EXISTING"])
    expect(first.unmatched.map((l) => l.sku)).toEqual(["E2E-MUG", "E2E-CAP"])
    expect(first.noSku).toHaveLength(1)
    expect(first.duplicates).toEqual([])

    const outcome = await runtime.importListings(["E2E-MUG"])
    expect(outcome).toEqual({ imported: ["E2E-MUG"], failed: [], skipped: [], deferred: [] })
    expect(fake.state.createdProducts).toHaveLength(1)
    expect(fake.state.createdProducts[0]).toMatchObject({
      title: "Mug",
      status: "draft",
      variants: [{ sku: "E2E-MUG", prices: [{ currency_code: "usd", amount: 9.5 }] }],
    })
    const { rows: links } = await pool.query(
      `SELECT external_sku, external_variant_id, medusa_variant_id
       FROM seller_hub.channel_listing
       WHERE integration_account_id = $1 AND external_sku = 'E2E-MUG'`,
      [accountId]
    )
    expect(links).toEqual([
      { external_sku: "E2E-MUG", external_variant_id: "2", medusa_variant_id: expect.any(String) },
    ])
    const { rows: jobs } = await pool.query(
      `SELECT external_id, status FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'product' AND external_id = 'E2E-MUG'`,
      [accountId]
    )
    expect(jobs).toEqual([{ external_id: "E2E-MUG", status: "succeeded" }])

    const second = await runtime.previewImport()
    expect(second.matched.map((l) => l.sku).sort()).toEqual(["E2E-EXISTING", "E2E-MUG"])
    expect(second.unmatched.map((l) => l.sku)).toEqual(["E2E-CAP"])

    expect(woo.requests.length).toBeGreaterThan(0)
    expect(woo.requests.filter((r) => r.method !== "GET")).toEqual([])
  },
  30_000
)
