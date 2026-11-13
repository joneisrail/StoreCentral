import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import type http from "node:http"
import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createInternalHandler } from "../internal/connections.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { startShopify, type StartShopifyDeps } from "../shopify/bootstrap.js"
import { startWooCommerce } from "../woocommerce/bootstrap.js"
import { accountPool, type AccountRow } from "../test-support/account-pool.js"
import { createWebhookRegistry, dbKnownConnection } from "../webhook/registry.js"
import { createWebhookServer } from "../webhook/server.js"
import { createConnectorManager } from "./manager.js"
import { testShopifyConnection, testWooCommerceConnection } from "./test-connection.js"

// In-process end to end for the live connection flow: the real webhook server
// (with the real registry), the real internal handler, the real connector
// manager and the real Shopify / WooCommerce bootstraps, with fake HTTP (fetch
// fakes), fake queues/workers and an in-memory pool.

const ENC_KEY = "ab".repeat(32)
const INTERNAL = "internal-bearer-token"
const GOOD_TOKEN = "shpat_good_token"
const GOOD_TOKEN_2 = "shpat_good_token_two"
/** Each good token sees its own shop catalogue, so two connections link different listings. */
const SKU_BY_TOKEN: Record<string, string> = { [GOOD_TOKEN]: "SKU-A", [GOOD_TOKEN_2]: "SKU-B" }
const WH1 = "shopify_wh_secret_one"
const WH2 = "shopify_wh_secret_two"
const SHOP = "shop.myshopify.com"

type Row = AccountRow

/** channel_listing inserts the real SKU link ran. */
let listings: { accountId: string; sku: string }[]

/** Pool handed to the real bootstraps: account lookups succeed, listing inserts are recorded. */
const bootPool = {
  query: async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO seller_hub\.channel_listing/.test(sql)) {
      listings.push({ accountId: String(params[0]), sku: String(params[3]) })
      return { rows: [], rowCount: 1 }
    }
    if (/integration_account/.test(sql)) {
      return { rows: [{ id: "acct-1", shop_domain: SHOP, shopify_location_id: "gid://shopify/Location/1" }] }
    }
    return { rows: [], rowCount: 0 }
  },
} as unknown as Pool

// ---- fake queues and workers ----------------------------------------------

class FakeQueue {
  added: { name: string; data: unknown; opts?: unknown }[] = []
  closed = false
  constructor(readonly name: string) {}
  async add(name: string, data: unknown, opts?: unknown) {
    this.added.push({ name, data, opts })
    return {}
  }
  async removeRepeatable() {}
  async close() {
    this.closed = true
  }
}

let queues: FakeQueue[]
const fakeCreateQueue = ((name: string) => {
  const q = new FakeQueue(name)
  queues.push(q)
  return q
}) as never
const fakeCreateWorker = (() => ({ close: async () => {} })) as never
const liveQueue = (name: string): FakeQueue | undefined =>
  [...queues].reverse().find((q) => q.name === name)

// ---- fake HTTP -------------------------------------------------------------

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })

/** Fake Shopify Admin GraphQL: only the tokens in SKU_BY_TOKEN are accepted. */
const shopifyFetch = (async (_url: unknown, init: RequestInit) => {
  const headers = new Headers(init.headers)
  const sku = SKU_BY_TOKEN[headers.get("X-Shopify-Access-Token") ?? ""]
  if (!sku) return json({ errors: "no" }, 401)
  const { query } = JSON.parse(String(init.body)) as { query: string }
  if (query.includes("ConnectionTest")) {
    return json({ data: { shop: { name: "Test Shop" }, location: { id: "gid://shopify/Location/1" } } })
  }
  if (query.includes("productVariants(first")) {
    return json({
      data: {
        productVariants: {
          nodes: [
            {
              id: `gid://shopify/ProductVariant/${sku}`,
              sku,
              price: "1.00",
              inventoryItem: { id: `gid://shopify/InventoryItem/${sku}` },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    })
  }
  return json({ data: {} })
}) as unknown as typeof fetch

const wooFetch = (async () => json([])) as unknown as typeof fetch

const medusaClient = {
  listVariantsBySku: vi.fn(async () => [
    { sku: "SKU-A", productId: "prod_a", variantId: "var_a" },
    { sku: "SKU-B", productId: "prod_b", variantId: "var_b" },
  ]),
  findSalesChannelIdByName: vi.fn(async () => null),
} as unknown as MedusaAdminClient

// ---- harness ---------------------------------------------------------------

let server: http.Server | undefined
let base = ""
let wooShouldFail = false

/** Mimics resolve*Account creating the unmanaged row when a legacy runtime starts. */
const ensureLegacyRow = (rows: Row[], marketplace: string) => {
  if (!rows.some((r) => r.marketplace === marketplace && !r.managed)) {
    rows.push({ id: `legacy-${marketplace}`, marketplace, status: "connected" })
  }
}

type Harness = {
  env?: NodeJS.ProcessEnv
  internalSecret?: string | null
  /** Reuse a credential store across boots to simulate a restart. */
  creds?: ReturnType<typeof accountPool>
}

const closeServer = async () => {
  if (!server) return
  const s = server
  server = undefined
  s.closeAllConnections?.()
  await new Promise((r) => s.close(r))
}

const boot = async (opts: Harness = {}) => {
  await closeServer()
  const creds = opts.creds ?? accountPool()
  const pool = creds.pool
  const env = opts.env ?? {}
  const manager = createConnectorManager({
    pool,
    medusaClient,
    encryptionKey: ENC_KEY,
    redisConnection: {} as IORedis,
    reconcileIntervalMs: 60_000,
    env,
    startShopify: (d: StartShopifyDeps) =>
      (ensureLegacyRow(creds.rows, "shopify"), startShopify({
        ...d,
        pool: bootPool,
        createQueue: fakeCreateQueue,
        createWorker: fakeCreateWorker,
        fetchImpl: shopifyFetch,
        sleep: async () => {},
      })),
    startWooCommerce: async (d) => {
      if (wooShouldFail) throw new Error("woo boom")
      ensureLegacyRow(creds.rows, "woocommerce")
      return startWooCommerce({
        ...d,
        pool: bootPool,
        createQueue: fakeCreateQueue,
        createWorker: fakeCreateWorker,
        fetchImpl: wooFetch,
        sleep: async () => {},
      })
    },
  })
  await manager.applyAll()

  const internalHandler =
    opts.internalSecret === null
      ? undefined
      : createInternalHandler({
          pool,
          manager,
          encryptionKey: ENC_KEY,
          secret: opts.internalSecret ?? INTERNAL,
          publicUrl: "https://hub.example.com",
          env,
          testShopify: (c) => testShopifyConnection(c, { fetchImpl: shopifyFetch }),
          testWoo: (c) => testWooCommerceConnection(c, { fetchImpl: wooFetch }),
        })

  server = createWebhookServer({
    inventoryQueue: new FakeQueue("inventory-sync") as never,
    priceQueue: new FakeQueue("price-sync") as never,
    connectors: createWebhookRegistry(manager, dbKnownConnection(pool)),
    ...(internalHandler ? { internalHandler } : {}),
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { manager, creds }
}

beforeEach(() => {
  queues = []
  listings = []
  wooShouldFail = false
  for (const k of ["log", "error", "warn", "info"] as const) vi.spyOn(console, k).mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await closeServer()
})

const internal = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${INTERNAL}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : null }
}

const shopifyBody = (token: string, secret: string, channel = "sc_1", shop = SHOP) => ({
  marketplace: "shopify",
  sales_channel_id: channel,
  shop_domain: shop,
  access_token: token,
  webhook_secret: secret,
  location_id: "1",
})

const sendShopifyWebhook = async (secret: string, orderId = 1001, id?: string) => {
  const raw = JSON.stringify({ id: orderId, admin_graphql_api_id: `gid://shopify/Order/${orderId}` })
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("base64")
  const res = await fetch(`${base}/webhooks/shopify${id ? `/${id}` : ""}`, {
    method: "POST",
    headers: { "x-shopify-hmac-sha256": sig, "x-shopify-topic": "orders/paid" },
    body: raw,
  })
  return res.status
}

const orderJobs = () => queues.filter((q) => q.name.startsWith("shopify-order-sync")).flatMap((q) => q.added)

test("create a Shopify connection with good credentials, then a signed orders/paid webhook is enqueued", async () => {
  await boot()
  expect(await sendShopifyWebhook(WH1)).toBe(503)

  const created = await internal("POST", "/internal/connections", shopifyBody(GOOD_TOKEN, WH1))
  expect(created.status).toBe(200)
  expect(created.json.ok).toBe(true)
  expect(created.text).not.toContain(GOOD_TOKEN)
  expect(created.text).not.toContain(WH1)

  expect(await sendShopifyWebhook(WH1)).toBe(200)
  expect(orderJobs()).toHaveLength(1)
  expect(orderJobs()[0]!.name).toBe("orders/paid")
})

test("create with a bad token saves the connection as error and starts nothing", async () => {
  const { creds } = await boot()
  const created = await internal("POST", "/internal/connections", shopifyBody("shpat_bad", WH1))
  expect(created.status).toBe(200)
  expect(created.json.test.ok).toBe(false)
  expect(created.json.connection.status).toBe("error")
  expect(created.text).not.toContain("shpat_bad")
  expect(creds.rows.find((r) => r.id === created.json.connection.id)!.status).toBe("error")
  expect(await sendShopifyWebhook(WH1)).toBe(503)
})

test("edit with a bad token returns 422 and the earlier connection still accepts webhooks", async () => {
  await boot()
  const created = await internal("POST", "/internal/connections", shopifyBody(GOOD_TOKEN, WH1))
  const id = created.json.connection.id as string

  const bad = await internal("PUT", `/internal/connections/${id}`, shopifyBody("shpat_bad", WH2))
  expect(bad.status).toBe(422)
  expect(bad.text).not.toContain("shpat_bad")

  expect(await sendShopifyWebhook(WH1)).toBe(200)
  expect(await sendShopifyWebhook(WH2)).toBe(401)
})

test("edit with new credentials swaps the webhook secret live without restarting the server", async () => {
  await boot()
  const created = await internal("POST", "/internal/connections", shopifyBody(GOOD_TOKEN, WH1))
  const id = created.json.connection.id as string
  expect(await sendShopifyWebhook(WH1)).toBe(200)

  const swap = await internal("PUT", `/internal/connections/${id}`, shopifyBody(GOOD_TOKEN, WH2))
  expect(swap.status).toBe(200)

  expect(await sendShopifyWebhook(WH1, 1002)).toBe(401)
  expect(await sendShopifyWebhook(WH2, 1003)).toBe(200)
  // The first runtime's queues were closed when it was replaced.
  expect(queues.filter((q) => q.name.startsWith("shopify-order-sync"))[0]!.closed).toBe(true)
})

test("DELETE makes /webhooks/shopify return 503 and stops the runtime", async () => {
  const { manager } = await boot()
  const created = await internal("POST", "/internal/connections", shopifyBody(GOOD_TOKEN, WH1))
  const id = created.json.connection.id as string
  expect(await sendShopifyWebhook(WH1)).toBe(200)

  const del = await internal("DELETE", `/internal/connections/${id}`)
  expect(del.status).toBe(200)
  expect(manager.get(id)).toBeNull()
  expect(await sendShopifyWebhook(WH1)).toBe(503)
})

test("without an internal secret /internal/connections is 404", async () => {
  await boot({ internalSecret: null })
  const res = await fetch(`${base}/internal/connections`, {
    headers: { authorization: `Bearer ${INTERNAL}` },
  })
  expect(res.status).toBe(404)
})

test("a WooCommerce start failure leaves Shopify serving", async () => {
  wooShouldFail = true
  const { manager } = await boot()
  await internal("POST", "/internal/connections", shopifyBody(GOOD_TOKEN, WH1))

  const woo = await internal("POST", "/internal/connections", {
    marketplace: "woocommerce",
    sales_channel_id: "sc_woo",
    site_url: "https://woo.example.com",
    consumer_key: "ck_key",
    consumer_secret: "cs_secret",
    webhook_secret: "woo_wh",
  })
  expect(woo.status).toBe(200)
  expect(woo.json.ok).toBe(false)
  expect(manager.list("woocommerce")).toEqual([])

  expect(await sendShopifyWebhook(WH1)).toBe(200)
})

const ENV_SHOPIFY = {
  SHOPIFY_SHOP_DOMAIN: SHOP,
  SHOPIFY_ACCESS_TOKEN: GOOD_TOKEN,
  SHOPIFY_WEBHOOK_SECRET: WH1,
  SHOPIFY_LOCATION_ID: "gid://shopify/Location/1",
} as NodeJS.ProcessEnv

test("env-only config with no stored connection still starts and serves webhooks", async () => {
  await boot({ env: ENV_SHOPIFY })
  expect(await sendShopifyWebhook(WH1)).toBe(200)
  expect(orderJobs()).toHaveLength(1)
})

// ---- many connections --------------------------------------------------------

type Booted = Awaited<ReturnType<typeof boot>>

/** Creates a Shopify connection through the internal API and waits for its SKU link. */
const createConnection = async (
  manager: Booted["manager"],
  token: string,
  secret: string,
  channel: string,
  shop: string
) => {
  const res = await internal("POST", "/internal/connections", shopifyBody(token, secret, channel, shop))
  expect(res.status).toBe(200)
  expect(res.json.ok).toBe(true)
  const id = res.json.connection.id as string
  await (manager.get(id)!.runtime as { linked: Promise<unknown> }).linked
  return id
}

const queueFor = (kind: string, id: string) => liveQueue(`shopify-${kind}-sync-${id}`)

test("two shopify connections sync independently (separate queues and listings)", async () => {
  const { manager } = await boot()
  const a = await createConnection(manager, GOOD_TOKEN, WH1, "sc_a", "a.myshopify.com")
  const b = await createConnection(manager, GOOD_TOKEN_2, WH2, "sc_b", "b.myshopify.com")
  expect(a).not.toBe(b)

  // Separate listings: each account linked only its own shop's SKU.
  expect(listings).toHaveLength(2)
  expect(listings).toEqual(
    expect.arrayContaining([
      { accountId: a, sku: "SKU-A" },
      { accountId: b, sku: "SKU-B" },
    ])
  )

  // Separate queues, each reached with its own secret on its own URL.
  expect(queueFor("order", a)).not.toBe(queueFor("order", b))
  expect(await sendShopifyWebhook(WH1, 2001, a)).toBe(200)
  expect(queueFor("order", a)!.added).toHaveLength(1)
  expect(queueFor("order", b)!.added).toHaveLength(0)
  expect(await sendShopifyWebhook(WH2, 2002, b)).toBe(200)
  expect(queueFor("order", b)!.added).toHaveLength(1)
  expect(queueFor("order", a)!.added).toHaveLength(1)
  // One connection's secret is not accepted on the other's URL.
  expect(await sendShopifyWebhook(WH1, 2003, b)).toBe(401)

  // A Medusa event fans out to both connections' inventory queues.
  const medusa = await fetch(`${base}/webhooks/medusa`, {
    method: "POST",
    body: JSON.stringify({ event: "inventory-level.updated", data: { id: "il_1" } }),
  })
  expect(medusa.status).toBe(200)
  const fanned = (id: string) =>
    queueFor("inventory", id)!.added.filter((j) => j.name === "inventory-level.updated")
  expect(fanned(a)).toHaveLength(1)
  expect(fanned(b)).toHaveLength(1)
})

test("bad credentials on create save the channel link with status error and start nothing", async () => {
  const { manager, creds } = await boot()
  const res = await internal("POST", "/internal/connections", shopifyBody("shpat_bad", WH1, "sc_bad"))
  expect(res.status).toBe(200)
  expect(res.json.test.ok).toBe(false)
  expect(res.text).not.toContain("shpat_bad")
  const row = creds.rows.find((r) => r.id === res.json.connection.id)!
  expect(row.status).toBe("error")
  expect(row.medusa_sales_channel_id).toBe("sc_bad")
  expect(manager.list()).toEqual([])
  expect(queues.filter((q) => q.name.startsWith("shopify-"))).toEqual([])
  expect(listings).toEqual([])
})

test("restart (applyAll) brings back every saved connection", async () => {
  const first = await boot()
  const a = await createConnection(first.manager, GOOD_TOKEN, WH1, "sc_a", "a.myshopify.com")
  const b = await createConnection(first.manager, GOOD_TOKEN_2, WH2, "sc_b", "b.myshopify.com")
  await first.manager.stopAll()

  const second = await boot({ creds: first.creds })
  expect(second.manager.list("shopify").map((c) => c.id).sort()).toEqual([a, b].sort())
  expect(await sendShopifyWebhook(WH1, 3001, a)).toBe(200)
  expect(await sendShopifyWebhook(WH2, 3002, b)).toBe(200)
  // The restarted runtimes own fresh, open queues.
  expect(queueFor("order", a)!.closed).toBe(false)
  expect(queueFor("order", a)!.added).toHaveLength(1)
  expect(first.creds.rows.find((r) => r.id === a)!.status).toBe("connected")
})

test("restart does not start a connection whose create failed its test; Test passing starts it, failing leaves it off", async () => {
  const first = await boot()
  const a = await createConnection(first.manager, GOOD_TOKEN, WH1, "sc_a", "a.myshopify.com")
  const bad = await internal("POST", "/internal/connections", shopifyBody("shpat_bad", WH2, "sc_bad"))
  const badId = bad.json.connection.id as string
  expect(first.creds.rows.find((r) => r.id === badId)!.status).toBe("error")
  await first.manager.stopAll()

  const second = await boot({ creds: first.creds })
  expect(second.manager.get(a)).not.toBeNull()
  expect(second.manager.get(badId)).toBeNull()
  expect(first.creds.rows.find((r) => r.id === badId)!.status).toBe("error")
  expect(await sendShopifyWebhook(WH2, 3101, badId)).toBe(503)

  // Test still failing: stays off.
  const stillBad = await internal("POST", `/internal/connections/${badId}/test`)
  expect(stillBad.json.ok).toBe(false)
  expect(second.manager.get(badId)).toBeNull()

  // The owner fixes the credential at the source; a passing Test starts it.
  SKU_BY_TOKEN.shpat_bad = "SKU-A"
  try {
    const passing = await internal("POST", `/internal/connections/${badId}/test`)
    expect(passing.json.ok).toBe(true)
    expect(second.manager.get(badId)).not.toBeNull()
    expect(first.creds.rows.find((r) => r.id === badId)!.status).toBe("connected")
    expect(await sendShopifyWebhook(WH2, 3102, badId)).toBe(200)
  } finally {
    delete SKU_BY_TOKEN.shpat_bad
  }
})

test("legacy env connection and its old webhook URL keep working with no managed row", async () => {
  const { manager, creds } = await boot({ env: ENV_SHOPIFY })
  expect(creds.rows.some((r) => r.managed)).toBe(false)
  const live = manager.list("shopify")
  expect(live).toHaveLength(1)
  expect(live[0]!.legacy).toBe(true)

  // Old un-suffixed URL, plain and with a query string.
  expect(await sendShopifyWebhook(WH1, 4001)).toBe(200)
  const raw = JSON.stringify({ id: 4002 })
  const sig = crypto.createHmac("sha256", WH1).update(raw).digest("base64")
  const withQuery = await fetch(`${base}/webhooks/shopify?src=x`, {
    method: "POST",
    headers: { "x-shopify-hmac-sha256": sig, "x-shopify-topic": "orders/paid" },
    body: raw,
  })
  expect(withQuery.status).toBe(200)
  expect(orderJobs()).toHaveLength(2)
  expect(creds.rows.some((r) => r.managed)).toBe(false)
})

test("a managed connection overrides the env connection for its marketplace", async () => {
  const { manager } = await boot({ env: ENV_SHOPIFY })
  expect(manager.list("shopify")[0]!.legacy).toBe(true)
  await createConnection(manager, GOOD_TOKEN_2, WH2, "sc_b", "b.myshopify.com")
  // The old URL still answers, now via the legacy runtime (env secret), until restart.
  expect(await sendShopifyWebhook(WH1, 4101)).toBe(200)
})

test("disconnect stops only that connection", async () => {
  const { manager } = await boot()
  const a = await createConnection(manager, GOOD_TOKEN, WH1, "sc_a", "a.myshopify.com")
  const b = await createConnection(manager, GOOD_TOKEN_2, WH2, "sc_b", "b.myshopify.com")

  expect((await internal("DELETE", `/internal/connections/${a}`)).status).toBe(200)
  expect(manager.get(a)).toBeNull()
  expect(manager.get(b)).not.toBeNull()
  expect(queueFor("order", a)!.closed).toBe(true)
  expect(queueFor("order", b)!.closed).toBe(false)
  expect(await sendShopifyWebhook(WH2, 5001, b)).toBe(200)
})

test("a webhook for a stopped-but-known connection returns 503 and for an unknown id 404", async () => {
  const { manager } = await boot()
  const a = await createConnection(manager, GOOD_TOKEN, WH1, "sc_a", "a.myshopify.com")
  expect((await internal("DELETE", `/internal/connections/${a}`)).status).toBe(200)

  // Row kept (credentials cleared), runtime stopped: the sender should retry.
  expect(await sendShopifyWebhook(WH1, 6001, a)).toBe(503)
  // Never existed.
  expect(await sendShopifyWebhook(WH1, 6002, "7c1f0f2e-0a52-4d57-8d0c-9e1b6c3d2a11")).toBe(404)
  expect(await sendShopifyWebhook(WH1, 6003, "not-a-uuid")).toBe(404)
})
