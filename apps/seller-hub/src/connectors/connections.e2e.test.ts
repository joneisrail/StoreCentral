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
import { createWebhookServer } from "../webhook/server.js"
import { createConnectorManager, legacyManagerView } from "./manager.js"
import { testShopifyConnection, testWooCommerceConnection } from "./test-connection.js"

// In-process end to end for the live connection flow: the real webhook server,
// the real internal handler, the real connector manager and the real Shopify /
// WooCommerce bootstraps, with fake HTTP (fetch fakes), fake queues/workers
// and an in-memory pool.

const ENC_KEY = "ab".repeat(32)
const INTERNAL = "internal-bearer-token"
const GOOD_TOKEN = "shpat_good_token"
const WH1 = "shopify_wh_secret_one"
const WH2 = "shopify_wh_secret_two"
const SHOP = "shop.myshopify.com"

type Row = AccountRow

/** Pool handed to the real bootstraps: account lookups succeed, everything else is empty. */
const bootPool = {
  query: async (sql: string) => {
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

/** Fake Shopify Admin GraphQL: only GOOD_TOKEN is accepted. */
const shopifyFetch = (async (_url: unknown, init: RequestInit) => {
  const headers = new Headers(init.headers)
  if (headers.get("X-Shopify-Access-Token") !== GOOD_TOKEN) return json({ errors: "no" }, 401)
  const { query } = JSON.parse(String(init.body)) as { query: string }
  if (query.includes("ConnectionTest")) {
    return json({ data: { shop: { name: "Test Shop" }, location: { id: "gid://shopify/Location/1" } } })
  }
  if (query.includes("productVariants(first")) {
    return json({ data: { productVariants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } })
  }
  return json({ data: {} })
}) as unknown as typeof fetch

const wooFetch = (async () => json([])) as unknown as typeof fetch

const medusaClient = {
  listVariantsBySku: vi.fn(async () => []),
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

type Harness = { env?: NodeJS.ProcessEnv; internalSecret?: string | null; pool?: Pool }

const boot = async (opts: Harness = {}) => {
  const creds = accountPool()
  const pool = opts.pool ?? creds.pool
  const env = opts.env ?? {}
  const connectors = createConnectorManager({
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
  // Webhook getters still use the single-connection adapter until Task 5 wires the registry.
  const manager = legacyManagerView(connectors, pool)
  await manager.applyAll()

  const internalHandler =
    opts.internalSecret === null
      ? undefined
      : createInternalHandler({
          pool,
          manager: connectors,
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
    shopify: () => manager.getShopify()?.webhook ?? null,
    woocommerce: () => manager.getWooCommerce()?.webhook ?? null,
    ...(internalHandler ? { internalHandler } : {}),
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { manager, creds }
}

beforeEach(() => {
  queues = []
  wooShouldFail = false
  for (const k of ["log", "error", "warn", "info"] as const) vi.spyOn(console, k).mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (server) {
    const s = server
    server = undefined
    s.closeAllConnections?.()
    await new Promise((r) => s.close(r))
  }
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

const shopifyBody = (token: string, secret: string, channel = "sc_1") => ({
  marketplace: "shopify",
  sales_channel_id: channel,
  shop_domain: SHOP,
  access_token: token,
  webhook_secret: secret,
  location_id: "1",
})

const sendShopifyWebhook = async (secret: string, orderId = 1001) => {
  const raw = JSON.stringify({ id: orderId, admin_graphql_api_id: `gid://shopify/Order/${orderId}` })
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("base64")
  const res = await fetch(`${base}/webhooks/shopify`, {
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
  expect(manager.getShopify()).toBeNull()
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
  expect(manager.getWooCommerce()).toBeNull()

  expect(await sendShopifyWebhook(WH1)).toBe(200)
})

test("env-only config with no stored connection still starts and serves webhooks", async () => {
  await boot({
    env: {
      SHOPIFY_SHOP_DOMAIN: SHOP,
      SHOPIFY_ACCESS_TOKEN: GOOD_TOKEN,
      SHOPIFY_WEBHOOK_SECRET: WH1,
      SHOPIFY_LOCATION_ID: "gid://shopify/Location/1",
    } as NodeJS.ProcessEnv,
  })
  expect(await sendShopifyWebhook(WH1)).toBe(200)
  expect(orderJobs()).toHaveLength(1)
})
