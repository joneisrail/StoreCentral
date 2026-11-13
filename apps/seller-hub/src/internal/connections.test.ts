import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { decrypt, encrypt } from "../crypto/secret-box.js"
import { accountPool, type AccountRow } from "../test-support/account-pool.js"
import { createInternalHandler } from "./connections.js"

const KEY = "ab".repeat(32)
const TOKEN = "internal-bearer-token"
const SHOPIFY_TOKEN = "shpat_super_secret_token"
const SHOPIFY_WH = "shopify_wh_secret_value"
const WOO_SECRET = "cs_super_secret_value"
const WOO_WH = "woo_wh_secret_value"
const NEW_TOKEN = "shpat_brand_new_token"
const NEW_WH = "shopify_new_wh_secret"
const REFRESH = "Atzr|amazon_refresh_token_value"
const NO_ENV = {} as NodeJS.ProcessEnv

const SHOPIFY_ID = "11111111-1111-4111-8111-111111111111"
const WOO_ID = "22222222-2222-4222-8222-222222222222"
const LEGACY_ID = "33333333-3333-4333-8333-333333333333"
const AMAZON_ID = "44444444-4444-4444-8444-444444444444"
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999"

const SECRETS = [SHOPIFY_TOKEN, SHOPIFY_WH, WOO_SECRET, WOO_WH, NEW_TOKEN, NEW_WH, REFRESH, KEY, TOKEN]

const shopifyRow = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: SHOPIFY_ID,
  marketplace: "shopify",
  managed: true,
  display_name: "Main Shopify",
  status: "connected",
  medusa_sales_channel_id: "sc_shopify",
  shop_domain: "shop.myshopify.com",
  shopify_location_id: "123",
  access_token_encrypted: encrypt(SHOPIFY_TOKEN, KEY),
  webhook_secret_encrypted: encrypt(SHOPIFY_WH, KEY),
  ...over,
})
const wooRow = (): AccountRow => ({
  id: WOO_ID,
  marketplace: "woocommerce",
  managed: true,
  display_name: "Woo",
  status: "connected",
  medusa_sales_channel_id: "sc_woo",
  shop_domain: "https://woo.example.com",
  api_key: "ck_key",
  access_token_encrypted: encrypt(WOO_SECRET, KEY),
  webhook_secret_encrypted: encrypt(WOO_WH, KEY),
})
const legacyRow = (): AccountRow => ({
  id: LEGACY_ID,
  marketplace: "shopify",
  managed: false,
  status: "connected",
  shop_domain: "env.myshopify.com",
  shopify_location_id: "9",
})

const fakeManager = () => {
  const relink = vi.fn(async () => ({
    linked: 3,
    alreadyLinked: 1,
    unmatched: ["a", "b"],
    duplicates: ["c"],
  }))
  const live = new Set<string>([SHOPIFY_ID])
  const m = {
    live,
    relink,
    get: vi.fn((id: string) => (live.has(id) ? ({ id, runtime: { relink } } as never) : null)),
    list: vi.fn(() => []),
    apply: vi.fn(async (_id: string) => ({ started: true }) as { started: boolean; error?: string }),
    stop: vi.fn(async (_id: string) => {}),
    lockLog: [] as string[],
    // Mirrors the real manager: the callback gets unlocked apply/stop, which
    // is what keeps them from re-entering the per-id lock.
    withLock: vi.fn(async function (this: unknown, id: string, fn: (ops: any) => Promise<unknown>) {
      m.lockLog.push(`enter:${id}`)
      try {
        return await fn({
          apply: async () => {
            m.lockLog.push("apply")
            return m.apply(id)
          },
          stop: async () => {
            m.lockLog.push("stop")
            return m.stop(id)
          },
        })
      } finally {
        m.lockLog.push(`exit:${id}`)
      }
    }),
    applyAll: vi.fn(),
    stopAll: vi.fn(),
  }
  return m
}

let server: http.Server | undefined
let base = ""
let rows: AccountRow[]
let calls: { sql: string; params: unknown[] }[]
let manager: ReturnType<typeof fakeManager>
let testShopify: ReturnType<typeof vi.fn>
let testWoo: ReturnType<typeof vi.fn>
let logs: string[]

const stopServer = async () => {
  if (!server) return
  const s = server
  server = undefined
  s.closeAllConnections?.()
  await new Promise((r) => s.close(r))
}

const start = async (
  seed: AccountRow[] = [shopifyRow(), wooRow()],
  publicUrl?: string,
  env: NodeJS.ProcessEnv = NO_ENV
) => {
  await stopServer()
  const fp = accountPool(seed)
  rows = fp.rows
  calls = fp.calls
  manager = fakeManager()
  testShopify = vi.fn(async () => ({ ok: true, detail: "ok" }))
  testWoo = vi.fn(async () => ({ ok: true, detail: "ok" }))
  const handler = createInternalHandler({
    pool: fp.pool,
    manager: manager as never,
    encryptionKey: KEY,
    secret: TOKEN,
    publicUrl,
    env,
    testShopify: testShopify as never,
    testWoo: testWoo as never,
  })
  server = http.createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeEach(() => {
  logs = []
  for (const k of ["log", "error", "warn", "info"] as const)
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await stopServer()
})

const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : null }
}

const expectNoSecrets = (text: string) => {
  for (const s of SECRETS) expect(text).not.toContain(s)
}

const writes = () => calls.filter((c) => /^\s*(UPDATE|INSERT)/i.test(c.sql))

const shopifyCreate = (over: Record<string, unknown> = {}) => ({
  marketplace: "shopify",
  sales_channel_id: "sc_new",
  display_name: "Second Shopify",
  shop_domain: "second.myshopify.com",
  access_token: NEW_TOKEN,
  webhook_secret: NEW_WH,
  location_id: "77",
  ...over,
})

test("401 with no detail on every route without the token, including unknown paths", async () => {
  await start()
  for (const [m, p] of [
    ["GET", "/internal/connections"],
    ["POST", "/internal/connections"],
    ["PUT", `/internal/connections/${SHOPIFY_ID}`],
    ["POST", `/internal/connections/${SHOPIFY_ID}/test`],
    ["POST", `/internal/connections/${SHOPIFY_ID}/link`],
    ["DELETE", `/internal/connections/${SHOPIFY_ID}`],
    ["GET", "/internal/nope"],
  ] as const) {
    const body = m === "PUT" || (m === "POST" && p === "/internal/connections") ? {} : undefined
    const none = await call(m, p, body, null)
    expect(none.status).toBe(401)
    expect(none.text).toBe("")
    const bad = await call(m, p, body, "wrong")
    expect(bad.status).toBe(401)
  }
  expect(manager.apply).not.toHaveBeenCalled()
  expect(writes()).toHaveLength(0)
})

test("list never contains any secret value and shows non-secret fields", async () => {
  await start([shopifyRow(), wooRow(), legacyRow()], "https://hub.example.com/")
  const r = await call("GET", "/internal/connections?x=1")
  expect(r.status).toBe(200)
  expectNoSecrets(r.text)
  const list = r.json.connections as Record<string, unknown>[]
  expect(list.map((c) => c.id)).toEqual([SHOPIFY_ID, WOO_ID, LEGACY_ID])
  const [s, w] = list as [Record<string, any>, Record<string, any>]
  expect(Object.keys(s).sort()).toEqual(
    [
      "id",
      "marketplace",
      "display_name",
      "status",
      "last_error",
      "last_synced_at",
      "linked_listings",
      "sales_channel_id",
      "managed",
      "read_only",
      "credentials_source",
      "sync_live",
      "fields",
      "webhook_url",
    ].sort()
  )
  expect(s.credentials_source).toBe("database")
  expect(s.display_name).toBe("Main Shopify")
  expect(s.read_only).toBe(false)
  expect(s.managed).toBe(true)
  expect(s.sync_live).toBe(true)
  expect(s.sales_channel_id).toBe("sc_shopify")
  expect(s.linked_listings).toBe(2)
  expect(s.fields).toEqual({ shop_domain: "shop.myshopify.com", location_id: "123" })
  expect(w.fields).toEqual({ site_url: "https://woo.example.com", consumer_key_set: true })
  expect(w.sync_live).toBe(false)
})

test("webhook_url includes the marketplace and the id", async () => {
  await start([shopifyRow(), wooRow()], "https://hub.example.com/")
  const r = await call("GET", "/internal/connections")
  expect(r.json.connections[0].webhook_url).toBe(`https://hub.example.com/webhooks/shopify/${SHOPIFY_ID}`)
  expect(r.json.connections[1].webhook_url).toBe(`https://hub.example.com/webhooks/woocommerce/${WOO_ID}`)
  await start()
  const bare = await call("GET", "/internal/connections")
  expect(bare.json.connections[0].webhook_url).toBe(`/webhooks/shopify/${SHOPIFY_ID}`)
})

test("legacy row is listed read_only with credentials from the environment", async () => {
  await start([legacyRow()])
  const r = await call("GET", "/internal/connections")
  const c = r.json.connections[0]
  expect(c.managed).toBe(false)
  expect(c.read_only).toBe(true)
  expect(c.credentials_source).toBe("environment")
  const put = await call("PUT", `/internal/connections/${LEGACY_ID}`, { access_token: NEW_TOKEN })
  expect(put.status).toBe(400)
  expect(put.json).toEqual({ error: "read_only" })
  const del = await call("DELETE", `/internal/connections/${LEGACY_ID}`)
  expect(del.status).toBe(400)
  expect(del.json).toEqual({ error: "read_only" })
  expect(manager.stop).not.toHaveBeenCalled()
  expect(writes()).toHaveLength(0)
})

test("unknown and non-uuid ids are 404", async () => {
  await start()
  for (const [m, p] of [
    ["PUT", `/internal/connections/${UNKNOWN_ID}`],
    ["DELETE", `/internal/connections/${UNKNOWN_ID}`],
    ["POST", `/internal/connections/${UNKNOWN_ID}/test`],
    ["POST", `/internal/connections/${UNKNOWN_ID}/link`],
    ["PUT", "/internal/connections/shopify"],
    ["DELETE", "/internal/connections/not-a-uuid"],
    ["POST", "/internal/connections/shopify/test"],
  ] as const) {
    const r = await call(m, p, m === "PUT" ? {} : undefined)
    expect(r.status, `${m} ${p}`).toBe(404)
  }
  expect((await call("GET", "/internal/other")).status).toBe(404)
  expect((await call("PATCH", `/internal/connections/${SHOPIFY_ID}`)).status).toBe(405)
  expect((await call("GET", `/internal/connections/${SHOPIFY_ID}/link`)).status).toBe(405)
  expect((await call("DELETE", "/internal/connections")).status).toBe(405)
})

test("create with good credentials stores, applies and returns connected", async () => {
  await start()
  const r = await call("POST", "/internal/connections", shopifyCreate())
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(true)
  expect(r.json.test).toEqual({ ok: true })
  expect(r.json.connection.status).toBe("connected")
  expect(r.json.connection.marketplace).toBe("shopify")
  expect(r.json.connection.display_name).toBe("Second Shopify")
  expect(r.json.connection.sales_channel_id).toBe("sc_new")
  expectNoSecrets(r.text)
  const created = rows.find((x) => x.medusa_sales_channel_id === "sc_new")!
  expect(created.managed).toBe(true)
  expect(r.json.connection.id).toBe(created.id)
  expect(testShopify.mock.calls[0]![0]).toEqual({
    shopDomain: "second.myshopify.com",
    accessToken: NEW_TOKEN,
    webhookSecret: NEW_WH,
    locationId: "77",
  })
  expect(manager.apply).toHaveBeenCalledWith(created.id)
  expect(decrypt(created.access_token_encrypted as string, KEY)).toBe(NEW_TOKEN)
  expect(JSON.stringify(calls.flatMap((c) => c.params))).not.toContain(NEW_TOKEN)
  expectNoSecrets(logs.join("\n"))
})

test("create with a failing test still stores the credentials with status error and applies nothing", async () => {
  await start()
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const r = await call("POST", "/internal/connections", shopifyCreate())
  expect(r.status).toBe(200)
  expect(r.json.test).toEqual({ ok: false, message: "credentials rejected" })
  expect(r.json.connection.status).toBe("error")
  expect(r.json.connection.last_error).toBe("credentials rejected")
  expectNoSecrets(r.text)
  const created = rows.find((x) => x.medusa_sales_channel_id === "sc_new")!
  expect(created.status).toBe("error")
  expect(decrypt(created.access_token_encrypted as string, KEY)).toBe(NEW_TOKEN)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("create with incomplete fields stores only the row as disconnected and runs no test", async () => {
  await start()
  const r = await call("POST", "/internal/connections", {
    marketplace: "shopify",
    sales_channel_id: "sc_new",
    shop_domain: "second.myshopify.com",
  })
  expect(r.status).toBe(200)
  expect(r.json.test).toBeNull()
  expect(r.json.connection.status).toBe("disconnected")
  const created = rows.find((x) => x.medusa_sales_channel_id === "sc_new")!
  expect(created.access_token_encrypted).toBeUndefined()
  expect(created.display_name).toBe("Shopify")
  expect(testShopify).not.toHaveBeenCalled()
  expect(manager.apply).not.toHaveBeenCalled()
})

test("create reports a start failure as ok:false with the connection", async () => {
  await start()
  manager.apply.mockResolvedValueOnce({ started: false, error: "failed to start" })
  const r = await call("POST", "/internal/connections", shopifyCreate())
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(false)
  expect(r.json.error).toBe("failed to start")
  expect(r.json.connection.marketplace).toBe("shopify")
  expectNoSecrets(r.text)
})

test("create a woocommerce connection tests it with the woo tester", async () => {
  await start([])
  const r = await call("POST", "/internal/connections", {
    marketplace: "woocommerce",
    sales_channel_id: "sc_w",
    site_url: "https://shop.example.com/",
    consumer_key: "ck_new",
    consumer_secret: WOO_SECRET,
    webhook_secret: WOO_WH,
  })
  expect(r.status).toBe(200)
  expect(r.json.connection.fields).toEqual({ site_url: "https://shop.example.com", consumer_key_set: true })
  expect(testWoo).toHaveBeenCalledTimes(1)
  expect(testShopify).not.toHaveBeenCalled()
  expectNoSecrets(r.text)
})

test("create amazon stores credentials, status disconnected, sync_live false, and calls neither the tester nor the manager", async () => {
  await start()
  const r = await call("POST", "/internal/connections", {
    marketplace: "amazon",
    sales_channel_id: "sc_amz",
    seller_id: "SELLER1",
    marketplace_id: "A1F83G8C2ARO7P",
    refresh_token: REFRESH,
  })
  expect(r.status).toBe(200)
  expect(r.json.test).toBeNull()
  expect(r.json.connection.status).toBe("disconnected")
  expect(r.json.connection.sync_live).toBe(false)
  expect(r.json.connection.fields).toEqual({ seller_id: "SELLER1", marketplace_id: "A1F83G8C2ARO7P" })
  expectNoSecrets(r.text)
  const created = rows.find((x) => x.medusa_sales_channel_id === "sc_amz")!
  expect(decrypt(created.lwa_refresh_token_encrypted as string, KEY)).toBe(REFRESH)
  expect(JSON.stringify(calls.flatMap((c) => c.params))).not.toContain(REFRESH)
  expect(testShopify).not.toHaveBeenCalled()
  expect(testWoo).not.toHaveBeenCalled()
  expect(manager.apply).not.toHaveBeenCalled()
  expect(manager.get).not.toHaveBeenCalledWith(created.id)

  const list = await call("GET", "/internal/connections")
  expectNoSecrets(list.text)
  const row = list.json.connections.find((c: { id: string }) => c.id === created.id)
  expect(row.sync_live).toBe(false)
  expect(row.credentials_source).toBe("database")
})

test("create rejects a sales channel that already has a connection (400 invalid_input)", async () => {
  await start()
  const before = rows.length
  const r = await call("POST", "/internal/connections", shopifyCreate({ sales_channel_id: "sc_shopify" }))
  expect(r.status).toBe(400)
  expect(r.json).toEqual({ error: "invalid_input", fields: ["sales_channel_id"] })
  expect(rows).toHaveLength(before)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("create validates marketplace, sales channel and value types", async () => {
  await start()
  const bad = async (body: unknown, fields: string[]) => {
    const r = await call("POST", "/internal/connections", body)
    expect(r.status).toBe(400)
    expect(r.json).toEqual({ error: "invalid_input", fields })
  }
  await bad(shopifyCreate({ marketplace: "ebay" }), ["marketplace"])
  await bad(shopifyCreate({ marketplace: undefined }), ["marketplace"])
  await bad(shopifyCreate({ sales_channel_id: "  " }), ["sales_channel_id"])
  await bad(shopifyCreate({ access_token: 5 }), [])
  expect(rows).toHaveLength(2)
  expect((await call("POST", "/internal/connections", "{not json")).status).toBe(400)
  expect((await call("POST", "/internal/connections", "[1]")).status).toBe(400)
})

test("edit of a connected connection with failing test returns 422 and changes nothing", async () => {
  await start()
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const before = JSON.stringify(rows)
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { access_token: NEW_TOKEN })
  expect(r.status).toBe(422)
  expect(r.json).toEqual({ error: "test_failed", message: "credentials rejected" })
  expect(JSON.stringify(rows)).toBe(before)
  expect(writes()).toHaveLength(0)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("a failed Test leaves the runtime live, so a failing edit is still guarded (422, nothing changed)", async () => {
  await start([shopifyRow({ status: "error" }), wooRow()])
  // SHOPIFY_ID still has a live runtime (a failed Test only sets status error).
  expect(manager.live.has(SHOPIFY_ID)).toBe(true)
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const before = JSON.stringify(rows)
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { access_token: NEW_TOKEN })
  expect(r.status).toBe(422)
  expect(JSON.stringify(rows)).toBe(before)
  expect(writes()).toHaveLength(0)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("edit saves and applies together under the connection lock", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { access_token: NEW_TOKEN })
  expect(r.status).toBe(200)
  expect(manager.lockLog).toEqual([`enter:${SHOPIFY_ID}`, "apply", `exit:${SHOPIFY_ID}`])
  expect(rows.find((x) => x.id === SHOPIFY_ID)!.access_token_encrypted).not.toBeNull()
})

test("edit ignores display_name, even a non-string one", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { display_name: 5 })
  expect(r.status).toBe(200)
  expect(rows.find((x) => x.id === SHOPIFY_ID)!.display_name).toBe("Main Shopify")
})

test("edit of a connected connection with a passing test stores, applies and leaks no secret", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, {
    access_token: NEW_TOKEN,
    sales_channel_id: "sc_other",
    bogus: 1,
  })
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(true)
  expect(r.json.connection.id).toBe(SHOPIFY_ID)
  expectNoSecrets(r.text)
  expect(testShopify.mock.calls[0]![0].accessToken).toBe(NEW_TOKEN)
  expect(manager.apply).toHaveBeenCalledWith(SHOPIFY_ID)
  const row = rows.find((x) => x.id === SHOPIFY_ID)!
  expect(decrypt(row.access_token_encrypted as string, KEY)).toBe(NEW_TOKEN)
  expect(row.medusa_sales_channel_id).toBe("sc_shopify")
  expectNoSecrets(logs.join("\n"))
})

test("edit of a non-connected connection saves regardless of a failing test", async () => {
  await start([shopifyRow({ status: "error", last_error: "old" }), wooRow()])
  manager.live.delete(SHOPIFY_ID) // no live runtime: nothing working to protect
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { access_token: NEW_TOKEN })
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(false)
  expect(r.json.test).toEqual({ ok: false, message: "credentials rejected" })
  expect(r.json.connection.status).toBe("error")
  expect(r.json.connection.last_error).toBe("credentials rejected")
  expectNoSecrets(r.text)
  const row = rows.find((x) => x.id === SHOPIFY_ID)!
  expect(decrypt(row.access_token_encrypted as string, KEY)).toBe(NEW_TOKEN)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("edit reports an apply start error as ok:false without raw text", async () => {
  await start()
  manager.apply.mockResolvedValueOnce({ started: false, error: "failed to start" })
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, {})
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(false)
  expect(r.json.error).toBe("failed to start")
  expect(r.json.connection.id).toBe(SHOPIFY_ID)
})

test("blank secret on edit keeps the stored value", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, {
    access_token: "   ",
    webhook_secret: "",
    location_id: "456",
  })
  expect(r.status).toBe(200)
  const tested = testShopify.mock.calls[0]![0]
  expect(tested.accessToken).toBe(SHOPIFY_TOKEN)
  expect(tested.webhookSecret).toBe(SHOPIFY_WH)
  expect(tested.locationId).toBe("456")
  const row = rows.find((x) => x.id === SHOPIFY_ID)!
  expect(decrypt(row.access_token_encrypted as string, KEY)).toBe(SHOPIFY_TOKEN)
})

test("edit of a connection with no stored credentials and missing fields is 400 listing them", async () => {
  await start([shopifyRow({ access_token_encrypted: null, webhook_secret_encrypted: null, status: "disconnected" })])
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { shop_domain: "a.myshopify.com" })
  expect(r.status).toBe(400)
  expect(r.json.error).toBe("invalid_input")
  expect(r.json.fields).toEqual(expect.arrayContaining(["accessToken", "webhookSecret"]))
  expect(testShopify).not.toHaveBeenCalled()
  expect(writes()).toHaveLength(0)
})

test("edit with an http:// Woo URL is 400 before the tester runs", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${WOO_ID}`, { site_url: "http://woo.example.com" })
  expect(r.status).toBe(400)
  expect(r.json.error).toBe("invalid_input")
  expect(testWoo).not.toHaveBeenCalled()
})

test("edit of an amazon connection stores the new token and never tests or applies", async () => {
  await start([
    {
      id: AMAZON_ID,
      marketplace: "amazon",
      managed: true,
      status: "disconnected",
      medusa_sales_channel_id: "sc_amz",
      amazon_seller_id: "SELLER1",
      amazon_marketplace_id: "ATVPDKIKX0DER",
      lwa_refresh_token_encrypted: encrypt("old_refresh_token", KEY),
    },
  ])
  const r = await call("PUT", `/internal/connections/${AMAZON_ID}`, { refresh_token: REFRESH })
  expect(r.status).toBe(200)
  expectNoSecrets(r.text)
  expect(r.json.connection.status).toBe("disconnected")
  const row = rows.find((x) => x.id === AMAZON_ID)!
  expect(decrypt(row.lwa_refresh_token_encrypted as string, KEY)).toBe(REFRESH)
  expect(row.amazon_seller_id).toBe("SELLER1")
  expect(testShopify).not.toHaveBeenCalled()
  expect(testWoo).not.toHaveBeenCalled()
  expect(manager.apply).not.toHaveBeenCalled()
})

test("edit rejects non-string values and malformed JSON with 400", async () => {
  await start()
  const a = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { access_token: 5 })
  expect(a.status).toBe(400)
  expect(a.json.error).toBe("invalid_input")
  expect((await call("PUT", `/internal/connections/${SHOPIFY_ID}`, "{not json")).status).toBe(400)
  expect((await call("PUT", `/internal/connections/${SHOPIFY_ID}`, "[1]")).status).toBe(400)
})

test("body over 64 KB is 413", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { access_token: "x".repeat(70_000) })
  expect(r.status).toBe(413)
  const c = await call("POST", "/internal/connections", shopifyCreate({ access_token: "x".repeat(70_000) }))
  expect(c.status).toBe(413)
  expect(manager.apply).not.toHaveBeenCalled()
  expect(writes()).toHaveLength(0)
})

test("stored credentials that cannot be decrypted are 500 stored_credentials_unreadable", async () => {
  await start([shopifyRow({ access_token_encrypted: "garbage" })])
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, {})
  expect(r.status).toBe(500)
  expect(r.json).toEqual({ error: "stored_credentials_unreadable" })
  expectNoSecrets(logs.join("\n"))
})

test("test route tests stored credentials and records status", async () => {
  await start()
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const r = await call("POST", `/internal/connections/${SHOPIFY_ID}/test`)
  expect(r.json).toEqual({ ok: false, message: "credentials rejected" })
  expect(testShopify.mock.calls[0]![0].accessToken).toBe(SHOPIFY_TOKEN)
  const row = rows.find((x) => x.id === SHOPIFY_ID)!
  expect(row.status).toBe("error")
  expect(row.last_error).toBe("credentials rejected")
  const ok = await call("POST", `/internal/connections/${SHOPIFY_ID}/test`)
  expect(ok.json.ok).toBe(true)
  expect(row.status).toBe("connected")
})

test("successful test with no live runtime starts the connection through the manager", async () => {
  await start()
  manager.live.clear()
  const r = await call("POST", `/internal/connections/${SHOPIFY_ID}/test`)
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(true)
  expect(manager.apply).toHaveBeenCalledWith(SHOPIFY_ID)
})

test("successful test with a live runtime only marks it connected and does not re-apply", async () => {
  await start()
  const r = await call("POST", `/internal/connections/${SHOPIFY_ID}/test`)
  expect(r.json.ok).toBe(true)
  expect(manager.apply).not.toHaveBeenCalled()
  expect(rows.find((x) => x.id === SHOPIFY_ID)!.status).toBe("connected")
})

test("failed test never applies, even with no live runtime", async () => {
  await start()
  manager.live.clear()
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const r = await call("POST", `/internal/connections/${SHOPIFY_ID}/test`)
  expect(r.json).toEqual({ ok: false, message: "credentials rejected" })
  expect(manager.apply).not.toHaveBeenCalled()
  expect(rows.find((x) => x.id === SHOPIFY_ID)!.status).toBe("error")
})

test("test route is 409 not_configured without stored credentials", async () => {
  await start([shopifyRow({ access_token_encrypted: null, webhook_secret_encrypted: null })])
  const r = await call("POST", `/internal/connections/${SHOPIFY_ID}/test`)
  expect(r.status).toBe(409)
  expect(r.json).toEqual({ error: "not_configured" })
  expect(testShopify).not.toHaveBeenCalled()
})

test("link returns counts, and 409 when the connection has no runtime", async () => {
  await start()
  const r = await call("POST", `/internal/connections/${SHOPIFY_ID}/link`)
  expect(r.status).toBe(200)
  expect(r.json).toEqual({ linked: 3, already_linked: 1, unmatched: 2, duplicates: 1 })
  const n = await call("POST", `/internal/connections/${WOO_ID}/link`)
  expect(n.status).toBe(409)
  expect(n.json).toEqual({ error: "not_running" })
})

test("delete stops, clears credentials, keeps the sales channel link", async () => {
  await start()
  const r = await call("DELETE", `/internal/connections/${SHOPIFY_ID}`)
  expect(r.status).toBe(200)
  expect(r.json).toEqual({ ok: true })
  expect(manager.stop).toHaveBeenCalledWith(SHOPIFY_ID)
  // stop and clear are one unit under the connection lock
  expect(manager.lockLog).toEqual([`enter:${SHOPIFY_ID}`, "stop", `exit:${SHOPIFY_ID}`])
  const row = rows.find((x) => x.id === SHOPIFY_ID)!
  expect(row.status).toBe("disconnected")
  expect(row.access_token_encrypted).toBeNull()
  expect(row.webhook_secret_encrypted).toBeNull()
  expect(row.medusa_sales_channel_id).toBe("sc_shopify")
  expect(rows.find((x) => x.id === WOO_ID)!.status).toBe("connected")
})

test("unexpected errors answer 500 and log only the constructor name", async () => {
  await start()
  manager.apply.mockRejectedValueOnce(new TypeError(`boom ${SHOPIFY_TOKEN}`))
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, {})
  expect(r.status).toBe(500)
  expect(r.json).toEqual({ error: "internal_error" })
  expect(logs.join("\n")).toContain("TypeError")
  expectNoSecrets(logs.join("\n"))
})

test("create with a Woo http:// URL keeps the row disconnected and reports the invalid field without values", async () => {
  await start([])
  const r = await call("POST", "/internal/connections", {
    marketplace: "woocommerce",
    sales_channel_id: "sc_w",
    site_url: "http://woo.example.com",
    consumer_key: "ck_new",
    consumer_secret: WOO_SECRET,
    webhook_secret: WOO_WH,
  })
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(false)
  expect(r.json.error).toBe("invalid_input")
  expect(r.json.input_problem).toBe("invalid")
  expect(r.json.fields).toEqual(["siteUrl"])
  expect(typeof r.json.message).toBe("string")
  expect(r.json.test).toBeNull()
  expect(r.json.connection.status).toBe("disconnected")
  expectNoSecrets(r.text)
  expect(r.text).not.toContain("woo.example.com")
  expect(rows.find((x) => x.medusa_sales_channel_id === "sc_w")!.status).toBe("disconnected")
  expect(testWoo).not.toHaveBeenCalled()
})

test("create with missing-only fields is ok with input_problem missing and the field names", async () => {
  await start()
  const r = await call("POST", "/internal/connections", {
    marketplace: "shopify",
    sales_channel_id: "sc_new",
    shop_domain: "second.myshopify.com",
    access_token: NEW_TOKEN,
  })
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(true)
  expect(r.json.input_problem).toBe("missing")
  expect(r.json.fields).toEqual(expect.arrayContaining(["webhookSecret", "locationId"]))
  expect(r.json.test).toBeNull()
  expectNoSecrets(r.text)
})

test("delete of an amazon connection never touches the manager", async () => {
  await start([
    {
      id: AMAZON_ID,
      marketplace: "amazon",
      managed: true,
      status: "disconnected",
      medusa_sales_channel_id: "sc_amz",
      amazon_seller_id: "SELLER1",
      lwa_refresh_token_encrypted: encrypt(REFRESH, KEY),
    },
  ])
  const r = await call("DELETE", `/internal/connections/${AMAZON_ID}`)
  expect(r.json).toEqual({ ok: true })
  expect(manager.stop).not.toHaveBeenCalled()
  expect(manager.get).not.toHaveBeenCalled()
  const row = rows.find((x) => x.id === AMAZON_ID)!
  expect(row.lwa_refresh_token_encrypted).toBeNull()
  expect(row.medusa_sales_channel_id).toBe("sc_amz")
})

test("a failure before credentials are saved removes the created row so a retry can succeed", async () => {
  await start()
  testShopify.mockRejectedValueOnce(new TypeError(`boom ${NEW_TOKEN}`))
  const r = await call("POST", "/internal/connections", shopifyCreate())
  expect(r.status).toBe(500)
  expect(rows.find((x) => x.medusa_sales_channel_id === "sc_new")).toBeUndefined()
  expectNoSecrets(logs.join(" "))
  const retry = await call("POST", "/internal/connections", shopifyCreate())
  expect(retry.status).toBe(200)
  expect(retry.json.ok).toBe(true)
})

test("a failure after credentials are saved never deletes the row", async () => {
  await start()
  manager.get.mockImplementation(() => {
    throw new TypeError(`boom ${NEW_TOKEN}`)
  })
  const r = await call("POST", "/internal/connections", shopifyCreate())
  expect(r.status).toBe(500)
  const row = rows.find((x) => x.medusa_sales_channel_id === "sc_new")
  expect(row).toBeDefined()
  expect(decrypt(row!.access_token_encrypted as string, KEY)).toBe(NEW_TOKEN)
  expect(calls.some((c) => /^\s*DELETE/i.test(c.sql))).toBe(false)
  expectNoSecrets(logs.join(" "))
})

test("edit with undecryptable ciphertext and a full but invalid body is 400 invalid_input", async () => {
  await start([wooRow()].map((r) => ({ ...r, access_token_encrypted: "garbage" })))
  const r = await call("PUT", `/internal/connections/${WOO_ID}`, {
    site_url: "http://woo.example.com",
    consumer_key: "ck_new",
    consumer_secret: WOO_SECRET,
    webhook_secret: WOO_WH,
  })
  expect(r.status).toBe(400)
  expect(r.json.error).toBe("invalid_input")
  expect(r.json.fields).toEqual(["siteUrl"])
  expect(typeof r.json.message).toBe("string")
  expectNoSecrets(r.text)
})

test("edit with undecryptable stored ciphertext replaces it when every field is supplied", async () => {
  await start([shopifyRow({ access_token_encrypted: "garbage" })])
  const full = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, {
    shop_domain: "shop.myshopify.com",
    access_token: NEW_TOKEN,
    webhook_secret: NEW_WH,
    location_id: "123",
  })
  expect(full.status).toBe(200)
  expect(full.json.ok).toBe(true)
  expectNoSecrets(full.text)
  const row = rows.find((x) => x.id === SHOPIFY_ID)!
  expect(decrypt(row.access_token_encrypted as string, KEY)).toBe(NEW_TOKEN)
})

test("edit with undecryptable stored ciphertext and partial input stays 500", async () => {
  await start([shopifyRow({ access_token_encrypted: "garbage" })])
  const r = await call("PUT", `/internal/connections/${SHOPIFY_ID}`, { location_id: "456" })
  expect(r.status).toBe(500)
  expect(r.json).toEqual({ error: "stored_credentials_unreadable" })
})

test("edit invalid input is 400 with message and fields", async () => {
  await start()
  const r = await call("PUT", `/internal/connections/${WOO_ID}`, { site_url: "http://woo.example.com" })
  expect(r.status).toBe(400)
  expect(r.json.fields).toEqual(["siteUrl"])
  expect(typeof r.json.message).toBe("string")
})
