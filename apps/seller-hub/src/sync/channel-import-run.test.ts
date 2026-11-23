import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { Pool } from "pg"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import {
  startFakeMedusa,
  type FakeMedusa,
  type FakeMedusaState,
} from "../test-support/fake-medusa.js"
import type { ChannelListing } from "./channel-import.js"
import { previewImport, runImport } from "./channel-import-run.js"
import { reconcileShopify } from "./reconcile.js"
import { reconcileWooCommerce } from "./reconcile-woocommerce.js"
import type { Queue } from "bullmq"

const listing = (
  externalId: string,
  sku: string | null,
  over: Partial<ChannelListing> = {}
): ChannelListing => ({
  externalId,
  parentExternalId: null,
  sku,
  title: `Title ${externalId}`,
  parentTitle: null,
  price: "12.50",
  stock: null,
  imageUrl: null,
  currency: null,
  ...over,
})

// A fake channel client: only `read` may be used by the importer.
const fakeChannel = (listings: ChannelListing[]) => {
  const client = {
    read: vi.fn(async () => listings),
    pushStock: vi.fn(async () => {
      throw new Error("channel write")
    }),
    pushPrice: vi.fn(async () => {
      throw new Error("channel write")
    }),
    createProduct: vi.fn(async () => {
      throw new Error("channel write")
    }),
  }
  return { client, channel: () => client.read() }
}

const medusas: FakeMedusa[] = []
const startMedusa = async (seed: Partial<FakeMedusaState> = {}) => {
  const fake = await startFakeMedusa(seed)
  medusas.push(fake)
  const medusaClient = new MedusaAdminClient({
    baseUrl: fake.baseUrl,
    email: "admin@test",
    password: "pw",
  })
  return { fake, medusaClient }
}

afterEach(async () => {
  while (medusas.length) await medusas.pop()!.close()
})

describe.skipIf(!process.env.TEST_DATABASE_URL)("channel import run (test database)", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: assertTestDatabase(process.env.TEST_DATABASE_URL) })
    await runMigrations(pool)
  }, 30_000)

  const accounts: string[] = []

  afterAll(async () => {
    if (pool && accounts.length > 0) {
      await pool.query(`DELETE FROM seller_hub.sync_job WHERE integration_account_id = ANY($1::uuid[])`, [accounts])
      await pool.query(`DELETE FROM seller_hub.channel_listing WHERE integration_account_id = ANY($1::uuid[])`, [accounts])
      await pool.query(`DELETE FROM seller_hub.integration_account WHERE id = ANY($1::uuid[])`, [accounts])
    }
    await pool?.end()
  })

  const newAccount = async (): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO seller_hub.integration_account (marketplace, status)
       VALUES ('woocommerce', 'connected') RETURNING id`
    )
    accounts.push(rows[0]!.id)
    return rows[0]!.id
  }

  const linksOf = async (acct: string) =>
    (
      await pool.query(
        `SELECT medusa_product_id, medusa_variant_id, external_sku, external_variant_id,
                external_parent_id, external_inventory_item_id, status
         FROM seller_hub.channel_listing WHERE integration_account_id = $1
         ORDER BY external_sku`,
        [acct]
      )
    ).rows

  const jobsOf = async (acct: string) =>
    (
      await pool.query(
        `SELECT sync_type, external_id, status, last_error
         FROM seller_hub.sync_job WHERE integration_account_id = $1
         ORDER BY external_id`,
        [acct]
      )
    ).rows

  const productPosts = (fake: FakeMedusa) =>
    fake.requests.filter((r) => r.method === "POST" && r.path.startsWith("/admin/products"))

  test("preview groups without writing", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa({
      variants: [
        {
          id: "var_m",
          product_id: "prod_m",
          sku: "M1",
          price: 1,
          currency_code: "usd",
          inventory_quantity: 0,
          inventory_item_id: "ii_m",
          inventory_level_id: "il_m",
        },
      ],
    })
    const m = listing("1", "M1")
    const u = listing("2", "U1")
    const d1 = listing("3", "D")
    const d2 = listing("4", "D")
    const n = listing("5", null)
    const { client, channel } = fakeChannel([m, u, d1, d2, n])

    const plan = await previewImport({ channel, medusaClient })

    expect(plan).toEqual({ matched: [m], unmatched: [u], duplicates: ["D"], noSku: [n] })
    expect(fake.requests.filter((r) => r.method !== "GET" && !r.path.startsWith("/auth"))).toEqual([])
    expect(client.read).toHaveBeenCalledTimes(1)
    expect(await linksOf(acct)).toEqual([])
    expect(await jobsOf(acct)).toEqual([])
  })

  test("creates draft product and link row", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([
      listing("21", " SKU-A ", {
        parentExternalId: "20",
        parentTitle: "Shirt",
        title: "Red",
        price: "19.99",
        stock: 7,
        imageUrl: "https://img.example/a.jpg",
        currency: "USD",
      }),
      listing("30", "SKU-B", { title: "Mug", parentTitle: "Mug" }),
    ])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome).toEqual({ imported: ["SKU-A", "SKU-B"], failed: [], skipped: [], deferred: [] })
    expect(fake.state.createdProducts).toHaveLength(2)
    const a = fake.state.createdProducts[0]
    expect(a).toMatchObject({
      title: "Shirt - Red",
      status: "draft",
      thumbnail: "https://img.example/a.jpg",
      variants: [
        {
          sku: "SKU-A",
          manage_inventory: true,
          prices: [{ currency_code: "usd", amount: 19.99 }],
        },
      ],
    })
    expect(fake.state.createdProducts[1].title).toBe("Mug")
    expect(fake.state.createdProducts[1].variants[0].manage_inventory).toBe(false)
    expect(fake.state.locationLevels).toEqual([
      { inventoryItemId: expect.any(String), body: { location_id: "sloc_default", stocked_quantity: 7 } },
    ])

    const created = fake.state.variants
    const links = await linksOf(acct)
    expect(links).toEqual([
      {
        medusa_product_id: created[0]!.product_id,
        medusa_variant_id: created[0]!.id,
        external_sku: "SKU-A",
        external_variant_id: "21",
        external_parent_id: "20",
        external_inventory_item_id: null,
        status: "published",
      },
      {
        medusa_product_id: created[1]!.product_id,
        medusa_variant_id: created[1]!.id,
        external_sku: "SKU-B",
        external_variant_id: "30",
        external_parent_id: null,
        external_inventory_item_id: null,
        status: "published",
      },
    ])
  })

  test("idempotent second run skips linked", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([listing("1", "A"), listing("2", "B")])

    await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })
    expect(fake.state.createdProducts).toHaveLength(2)

    const again = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })
    expect(again).toEqual({
      imported: [],
      failed: [],
      skipped: [
        { sku: "A", reason: "already_linked" },
        { sku: "B", reason: "already_linked" },
      ],
      deferred: [],
    })

    const named = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: ["A", "B"] })
    expect(named).toEqual({
      imported: [],
      failed: [],
      skipped: [
        { sku: "A", reason: "already_linked" },
        { sku: "B", reason: "already_linked" },
      ],
      deferred: [],
    })

    // A link row whose StoreCentral variant is gone still blocks a re-create.
    fake.state.variants = []
    const gone = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })
    expect(gone.skipped).toEqual([
      { sku: "A", reason: "already_linked" },
      { sku: "B", reason: "already_linked" },
    ])
    expect(gone.imported).toEqual([])
    expect(fake.state.createdProducts).toHaveLength(2)
    expect(await linksOf(acct)).toHaveLength(2)
  })

  test("partial failure records sync_job and continues", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([
      listing("1", "OK-1"),
      listing("2", "NO-PRICE", { price: "" }),
      listing("3", "OK-2"),
    ])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.imported).toEqual(["OK-1", "OK-2"])
    expect(outcome.failed).toEqual([{ sku: "NO-PRICE", message: "channel listing has no price" }])
    expect(fake.state.createdProducts.map((p) => p.variants[0].sku)).toEqual(["OK-1", "OK-2"])
    const jobs = await jobsOf(acct)
    expect(jobs.filter((j) => j.status === "failed")).toEqual([
      { sync_type: "product", external_id: "NO-PRICE", status: "failed", last_error: "channel listing has no price" },
    ])
  })

  test("a Medusa create error is sanitized, recorded, and the run continues", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa({
      productCreateError: { message: "bad", access_token: "shpat_supersecret" },
    })
    const { channel } = fakeChannel([listing("1", "X1"), listing("2", "X2")])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.imported).toEqual([])
    expect(outcome.failed.map((f) => f.sku)).toEqual(["X1", "X2"])
    expect(fake.state.createdProducts).toHaveLength(2)
    const jobs = await jobsOf(acct)
    expect(jobs).toHaveLength(2)
    for (const j of jobs) {
      expect(j.status).toBe("failed")
      expect(j.last_error).not.toContain("supersecret")
    }
    expect(await linksOf(acct)).toEqual([])
  })

  test("initial stock failure still links the draft and records a failed sync_job", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa({ locationLevelError: { message: "nope" } })
    const { channel } = fakeChannel([listing("1", "S1", { stock: 4 })])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.imported).toEqual([])
    expect(outcome.failed).toEqual([
      { sku: "S1", message: expect.stringMatching(/^draft created but initial stock failed/) },
    ])
    const links = await linksOf(acct)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      external_sku: "S1",
      medusa_variant_id: fake.state.variants[0]!.id,
      medusa_product_id: fake.state.variants[0]!.product_id,
    })
    const jobs = await jobsOf(acct)
    expect(jobs).toEqual([
      {
        sync_type: "product",
        external_id: "S1",
        status: "failed",
        last_error: expect.stringMatching(/^draft created but initial stock failed/),
      },
    ])
  })

  test("a later success clears an earlier failed sync_job", async () => {
    const acct = await newAccount()
    const { medusaClient } = await startMedusa()
    await runImport({
      pool,
      medusaClient,
      integrationAccountId: acct,
      channel: fakeChannel([listing("1", "R1", { price: "" })]).channel,
      skus: "all",
    })
    expect((await jobsOf(acct))[0]).toMatchObject({ status: "failed" })

    await runImport({
      pool,
      medusaClient,
      integrationAccountId: acct,
      channel: fakeChannel([listing("1", "R1", { price: "3" })]).channel,
      skus: "all",
    })
    expect((await jobsOf(acct))[0]).toMatchObject({ external_id: "R1", status: "succeeded", last_error: null })
  })

  test("cap of 200 defers the rest", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const all = Array.from({ length: 300 }, (_, i) => listing(String(i), `CAP-${String(i).padStart(3, "0")}`))
    const { channel } = fakeChannel(all)

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.imported).toHaveLength(200)
    expect(outcome.imported[0]).toBe("CAP-000")
    expect(outcome.imported[199]).toBe("CAP-199")
    expect(outcome.deferred).toEqual(all.slice(200).map((l) => l.sku))
    expect(fake.state.createdProducts).toHaveLength(200)
    expect(await linksOf(acct)).toHaveLength(200)
  }, 60_000)

  test("other currency skipped", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa({ defaultCurrency: "usd" })
    const { channel } = fakeChannel([
      listing("1", "EUR-1", { currency: "EUR" }),
      listing("2", "USD-1", { currency: "USD" }),
      listing("3", "NONE-1", { currency: null }),
    ])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.skipped).toEqual([{ sku: "EUR-1", reason: "currency" }])
    expect(outcome.imported).toEqual(["USD-1", "NONE-1"])
    expect(fake.state.createdProducts.map((p) => p.variants[0].sku)).toEqual(["USD-1", "NONE-1"])
    expect(fake.state.createdProducts[0].variants[0].prices[0].currency_code).toBe("usd")
  })

  test("never calls a channel write", async () => {
    const acct = await newAccount()
    const { medusaClient } = await startMedusa({ locationLevelError: { message: "x" } })
    const { client, channel } = fakeChannel([
      listing("1", "W1", { stock: 2 }),
      listing("2", "W2", { price: "" }),
      listing("3", "W3"),
    ])

    await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })
    await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(client.read).toHaveBeenCalledTimes(2)
    expect(client.pushStock).not.toHaveBeenCalled()
    expect(client.pushPrice).not.toHaveBeenCalled()
    expect(client.createProduct).not.toHaveBeenCalled()
  })

  test("selected skus only", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([listing("1", "P1"), listing("2", "P2"), listing("3", "P3")])

    const outcome = await runImport({
      pool,
      medusaClient,
      integrationAccountId: acct,
      channel,
      skus: [" P3 ", "P1", "NOT-ON-CHANNEL"],
    })

    expect(outcome).toEqual({ imported: ["P1", "P3"], failed: [], skipped: [], deferred: [] })
    expect(fake.state.createdProducts.map((p) => p.variants[0].sku)).toEqual(["P1", "P3"])
    expect((await linksOf(acct)).map((l) => l.external_sku)).toEqual(["P1", "P3"])
  })

  test("a Shopify listing's inventory item id lands in the row", async () => {
    const acct = await newAccount()
    const { medusaClient } = await startMedusa()
    const { channel } = fakeChannel([
      listing("gid://shopify/ProductVariant/9", "SH-1", {
        parentExternalId: "gid://shopify/Product/1",
        inventoryItemId: "gid://shopify/InventoryItem/9",
      }),
      listing("10", "WOO-1"),
    ])

    await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    const links = await linksOf(acct)
    expect(links[0]).toMatchObject({
      external_sku: "SH-1",
      external_variant_id: "gid://shopify/ProductVariant/9",
      external_inventory_item_id: "gid://shopify/InventoryItem/9",
    })
    expect(links[1]).toMatchObject({ external_sku: "WOO-1", external_inventory_item_id: null })
  })

  test("a selected SKU that matches the store without a link is skipped as matched", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa({
      variants: [
        {
          id: "var_m",
          product_id: "prod_m",
          sku: "M1",
          price: 1,
          currency_code: "usd",
          inventory_quantity: 0,
          inventory_item_id: "ii_m",
          inventory_level_id: "il_m",
        },
      ],
    })
    const { channel } = fakeChannel([listing("1", "M1"), listing("2", "U1")])

    const named = await runImport({
      pool,
      medusaClient,
      integrationAccountId: acct,
      channel,
      skus: ["M1", "GHOST"],
    })
    expect(named).toEqual({
      imported: [],
      failed: [],
      skipped: [{ sku: "M1", reason: "matched" }],
      deferred: [],
    })

    const all = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })
    expect(all).toEqual({
      imported: ["U1"],
      failed: [],
      skipped: [{ sku: "M1", reason: "matched" }],
      deferred: [],
    })
    expect(fake.state.createdProducts.map((p) => p.variants[0].sku)).toEqual(["U1"])
    expect((await linksOf(acct)).map((l) => l.external_sku)).toEqual(["U1"])
  })

  test("priceless listings fail without consuming cap slots", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const priceless = Array.from({ length: 200 }, (_, i) =>
      listing(String(i), `NP-${String(i).padStart(3, "0")}`, { price: "" })
    )
    const { channel } = fakeChannel([...priceless, listing("good", "GOOD-1")])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.imported).toEqual(["GOOD-1"])
    expect(outcome.deferred).toEqual([])
    expect(outcome.failed).toHaveLength(200)
    expect(outcome.failed[0]).toEqual({ sku: "NP-000", message: "channel listing has no price" })
    expect(fake.state.createdProducts.map((p) => p.variants[0].sku)).toEqual(["GOOD-1"])
    const jobs = await jobsOf(acct)
    expect(jobs.filter((j) => j.status === "failed")).toHaveLength(200)
    expect(jobs.find((j) => j.external_id === "NP-000")).toMatchObject({
      status: "failed",
      last_error: "channel listing has no price",
    })
  }, 60_000)

  test("negative channel stock is clamped to 0", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([listing("1", "NEG-1", { stock: -3 })])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.imported).toEqual(["NEG-1"])
    expect(fake.state.createdProducts[0].variants[0].manage_inventory).toBe(true)
    expect(fake.state.locationLevels).toEqual([
      { inventoryItemId: expect.any(String), body: { location_id: "sloc_default", stocked_quantity: 0 } },
    ])
  })

  test("imported links carry a sync baseline so neither reconcile queues a push", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([
      listing("1", "BL-STOCK", { stock: 5, price: "19.99" }),
      listing("2", "BL-NULL", { stock: null, price: "7" }),
      listing("3", "BL-FAIL", { stock: 3, price: "4.5" }),
    ])

    await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: ["BL-STOCK", "BL-NULL"] })
    fake.state.locationLevelError = { message: "stock step down" }
    const failedRun = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: ["BL-FAIL"] })
    expect(failedRun.failed.map((f) => f.sku)).toEqual(["BL-FAIL"])
    fake.state.locationLevelError = undefined

    const { rows } = await pool.query(
      `SELECT external_sku, last_synced_quantity, last_synced_price::text AS last_synced_price
       FROM seller_hub.channel_listing WHERE integration_account_id = $1 ORDER BY external_sku`,
      [acct]
    )
    expect(rows).toEqual([
      { external_sku: "BL-FAIL", last_synced_quantity: 0, last_synced_price: "4.5" },
      { external_sku: "BL-NULL", last_synced_quantity: 0, last_synced_price: "7" },
      { external_sku: "BL-STOCK", last_synced_quantity: 5, last_synced_price: "19.99" },
    ])

    const queues = () => ({
      inventoryQueue: { add: vi.fn() } as unknown as Queue,
      priceQueue: { add: vi.fn() } as unknown as Queue,
      orderQueue: { add: vi.fn() } as unknown as Queue,
    })
    const woo = queues()
    const wooResult = await reconcileWooCommerce({
      pool,
      medusaClient,
      integrationAccountId: acct,
      ...woo,
      fetchOrdersSince: async () => [],
    })
    expect(wooResult).toMatchObject({ inventoryRequeued: 0, priceRequeued: 0, failedChecks: 0 })
    expect(woo.inventoryQueue.add).not.toHaveBeenCalled()
    expect(woo.priceQueue.add).not.toHaveBeenCalled()

    const shop = queues()
    const shopResult = await reconcileShopify({
      pool,
      medusaClient,
      integrationAccountId: acct,
      ...shop,
      fetchOrdersSince: async () => [],
    })
    expect(shopResult).toMatchObject({ inventoryRequeued: 0, priceRequeued: 0, failedChecks: 0 })
    expect(shop.inventoryQueue.add).not.toHaveBeenCalled()
    expect(shop.priceQueue.add).not.toHaveBeenCalled()
  })

  test("Shopify's Default Title variant name is dropped from the draft title", async () => {
    const acct = await newAccount()
    const { fake, medusaClient } = await startMedusa()
    const { channel } = fakeChannel([
      listing("1", "DT-1", { title: "Default Title", parentTitle: "Poster" }),
      listing("2", "DT-2", { title: "Large", parentTitle: "Poster" }),
    ])

    await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(fake.state.createdProducts.map((p) => p.title)).toEqual(["Poster", "Poster - Large"])
  })

  test("a failure never overwrites a sync_job another run marked succeeded", async () => {
    const acct = await newAccount()
    const { medusaClient } = await startMedusa()
    await pool.query(
      `INSERT INTO seller_hub.sync_job (integration_account_id, sync_type, external_id, status)
       VALUES ($1, 'product', 'RACE-1', 'succeeded')`,
      [acct]
    )
    const { channel } = fakeChannel([listing("1", "RACE-1", { price: "" })])

    const outcome = await runImport({ pool, medusaClient, integrationAccountId: acct, channel, skus: "all" })

    expect(outcome.failed).toEqual([{ sku: "RACE-1", message: "channel listing has no price" }])
    expect(await jobsOf(acct)).toEqual([
      { sync_type: "product", external_id: "RACE-1", status: "succeeded", last_error: null },
    ])
  })
})
