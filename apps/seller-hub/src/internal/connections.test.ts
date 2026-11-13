import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { encrypt } from "../crypto/secret-box.js"
import { createInternalHandler } from "./connections.js"

const KEY = "ab".repeat(32)
const TOKEN = "internal-bearer-token"
const SHOPIFY_TOKEN = "shpat_super_secret_token"
const SHOPIFY_WH = "shopify_wh_secret_value"
const WOO_SECRET = "cs_super_secret_value"
const WOO_WH = "woo_wh_secret_value"
const NEW_TOKEN = "shpat_brand_new_token"
const NO_ENV = {} as NodeJS.ProcessEnv

type Row = Record<string, unknown> & { id: string; marketplace: string }

/** In-memory pool that recognises the few statements credentials.ts runs. */
const fakePool = (seed: Row[] = []) => {
  const rows: Row[] = [...seed]
  const calls: { sql: string; params: unknown[] }[] = []
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (/^\s*INSERT/i.test(sql)) {
        const row: Row = { id: `id-${rows.length + 1}`, marketplace: "" }
        const cols = /\(([^)]*)\)\s*VALUES/is.exec(sql)![1]!.split(",").map((c) => c.trim())
        const values = /VALUES\s*\((.*)\)/is.exec(sql)![1]!.split(",").map((v) => v.trim())
        cols.forEach((c, i) => {
          const v = values[i]!
          if (v.startsWith("$")) row[c] = params[Number(v.slice(1)) - 1]
          else row[c] = v.replace(/'/g, "")
        })
        row.marketplace = String(row.marketplace)
        rows.push(row)
        return { rows: [] }
      }
      if (/^\s*UPDATE/i.test(sql)) {
        const marketplace = params[params.length - 1] as string
        const row = rows.find((r) => r.marketplace === marketplace)
        if (!row) return { rows: [] }
        if (/shop_domain\s*=\s*NULL/i.test(sql)) {
          for (const c of [
            "shop_domain",
            "access_token_encrypted",
            "api_key",
            "shopify_location_id",
            "webhook_secret_encrypted",
            "medusa_sales_channel_id",
          ])
            row[c] = null
          row.status = "disconnected"
          row.last_error = null
        } else {
          const setClause = /SET\s+(.*?)\s+WHERE/is.exec(sql)![1]!
          for (const m of setClause.matchAll(/(\w+)\s*=\s*(\$\d+|'[^']*')/g)) {
            const v = m[2]!
            row[m[1]!] = v.startsWith("$") ? params[Number(v.slice(1)) - 1] : v.replace(/'/g, "")
          }
        }
        return { rows: [] }
      }
      if (/^\s*SELECT/i.test(sql)) {
        if (/linked_listings/.test(sql)) {
          return {
            rows: rows.map((r) => ({
              marketplace: r.marketplace,
              status: r.status ?? "disconnected",
              last_error: r.last_error ?? null,
              last_synced_at: null,
              medusa_sales_channel_id: r.medusa_sales_channel_id ?? null,
              linked_listings: "2",
              has_stored_credentials: r.webhook_secret_encrypted != null,
              shop_domain: r.shop_domain ?? null,
              shopify_location_id: r.shopify_location_id ?? null,
              api_key_present: r.api_key != null,
            })),
          }
        }
        return { rows: rows.filter((r) => r.marketplace === params[0]).slice(0, 1) }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, rows, calls }
}

const shopifyRow = (): Row => ({
  id: "r1",
  marketplace: "shopify",
  status: "connected",
  shop_domain: "shop.myshopify.com",
  shopify_location_id: "123",
  access_token_encrypted: encrypt(SHOPIFY_TOKEN, KEY),
  webhook_secret_encrypted: encrypt(SHOPIFY_WH, KEY),
})
const wooRow = (): Row => ({
  id: "r2",
  marketplace: "woocommerce",
  status: "connected",
  shop_domain: "https://woo.example.com",
  api_key: "ck_key",
  access_token_encrypted: encrypt(WOO_SECRET, KEY),
  webhook_secret_encrypted: encrypt(WOO_WH, KEY),
})

const SECRETS = [SHOPIFY_TOKEN, SHOPIFY_WH, WOO_SECRET, WOO_WH, NEW_TOKEN, KEY, TOKEN]

const fakeManager = () => {
  const relink = vi.fn(async () => ({
    linked: 3,
    alreadyLinked: 1,
    unmatched: ["a", "b"],
    duplicates: ["c"],
  }))
  const state = { shopify: true, woo: false }
  return {
    apply: vi.fn(async (_m: string) => ({ started: true }) as { started: boolean; error?: string }),
    stop: vi.fn(async (_m: string) => {}),
    getShopify: vi.fn(() => (state.shopify ? ({ relink } as never) : null)),
    getWooCommerce: vi.fn(() => (state.woo ? ({ relink } as never) : null)),
    applyAll: vi.fn(),
    stopAll: vi.fn(),
  }
}

let server: http.Server | undefined
let base = ""
let rows: Row[]
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
  env: NodeJS.ProcessEnv = NO_ENV,
  seed: Row[] = [shopifyRow(), wooRow()],
  publicUrl?: string
) => {
  await stopServer()
  const fp = fakePool(seed)
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

test("401 with no detail on every route without the token, including unknown paths", async () => {
  await start()
  for (const [m, p] of [
    ["GET", "/internal/connections"],
    ["PUT", "/internal/connections/shopify"],
    ["POST", "/internal/connections/shopify/test"],
    ["POST", "/internal/connections/shopify/link"],
    ["DELETE", "/internal/connections/shopify"],
    ["GET", "/internal/nope"],
  ] as const) {
    const none = await call(m, p, m === "PUT" ? {} : undefined, null)
    expect(none.status).toBe(401)
    expect(none.text).toBe("")
    const bad = await call(m, p, m === "PUT" ? {} : undefined, "wrong")
    expect(bad.status).toBe(401)
  }
  expect(manager.apply).not.toHaveBeenCalled()
})

test("GET lists connections without secrets and marks amazon read-only", async () => {
  await start(NO_ENV, [shopifyRow(), wooRow()], "https://hub.example.com/")
  const r = await call("GET", "/internal/connections?x=1")
  expect(r.status).toBe(200)
  expectNoSecrets(r.text)
  const list = r.json.connections
  expect(list.map((c: { marketplace: string }) => c.marketplace)).toEqual([
    "shopify",
    "woocommerce",
    "amazon",
  ])
  const [s, w, a] = list
  expect(s.credentials_source).toBe("database")
  expect(s.fields).toEqual({ shop_domain: "shop.myshopify.com", location_id: "123" })
  expect(s.webhook_url).toBe("https://hub.example.com/webhooks/shopify")
  expect(s.linked_listings).toBe(2)
  expect(w.fields).toEqual({ site_url: "https://woo.example.com", consumer_key_set: true })
  expect(a.read_only).toBe(true)
  expect(a.fields).toEqual({})
  expect(a.credentials_source).toBe("environment")
  expect(a.status).toBe("disconnected")
})

test("GET webhook_url is just the path without a public URL", async () => {
  await start()
  const r = await call("GET", "/internal/connections")
  expect(r.json.connections[0].webhook_url).toBe("/webhooks/shopify")
})

test("GET answers 500 stored_credentials_unreadable on undecryptable ciphertext", async () => {
  const bad = shopifyRow()
  bad.access_token_encrypted = "garbage"
  await start(NO_ENV, [bad])
  const r = await call("GET", "/internal/connections")
  expect(r.status).toBe(500)
  expect(r.json).toEqual({ error: "stored_credentials_unreadable" })
  expectNoSecrets(logs.join("\n"))
})

test("PUT with a failing tester returns 422 and stores/applies nothing", async () => {
  await start()
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const before = JSON.stringify(rows)
  const r = await call("PUT", "/internal/connections/shopify", { access_token: NEW_TOKEN })
  expect(r.status).toBe(422)
  expect(r.json).toEqual({ error: "test_failed", message: "credentials rejected" })
  expect(JSON.stringify(rows)).toBe(before)
  expect(calls.some((c) => /^\s*(UPDATE|INSERT)/i.test(c.sql))).toBe(false)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("PUT success stores, applies and leaks no secret", async () => {
  await start()
  const r = await call("PUT", "/internal/connections/shopify", {
    access_token: NEW_TOKEN,
    sales_channel_id: "sc_1",
    bogus: 1,
  })
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(true)
  expect(r.json.connection.marketplace).toBe("shopify")
  expectNoSecrets(r.text)
  expect(testShopify.mock.calls[0]![0].accessToken).toBe(NEW_TOKEN)
  expect(manager.apply).toHaveBeenCalledWith("shopify")
  expect(rows.find((x) => x.marketplace === "shopify")!.medusa_sales_channel_id).toBe("sc_1")
  expectNoSecrets(logs.join("\n"))
})

test("PUT reports an apply start error as ok:false without raw text", async () => {
  await start()
  manager.apply.mockResolvedValueOnce({ started: false, error: "failed to start" })
  const r = await call("PUT", "/internal/connections/shopify", {})
  expect(r.status).toBe(200)
  expect(r.json.ok).toBe(false)
  expect(r.json.error).toBe("failed to start")
})

test("blank access_token keeps the stored one", async () => {
  await start()
  const r = await call("PUT", "/internal/connections/shopify", { access_token: "   ", location_id: "456" })
  expect(r.status).toBe(200)
  expect(testShopify.mock.calls[0]![0].accessToken).toBe(SHOPIFY_TOKEN)
  expect(testShopify.mock.calls[0]![0].locationId).toBe("456")
})

test("PUT with missing fields returns 400 listing them", async () => {
  await start(NO_ENV, [])
  const r = await call("PUT", "/internal/connections/shopify", { shop_domain: "a.myshopify.com" })
  expect(r.status).toBe(400)
  expect(r.json.error).toBe("invalid_input")
  expect(r.json.fields).toEqual(expect.arrayContaining(["accessToken", "webhookSecret", "locationId"]))
  expect(testShopify).not.toHaveBeenCalled()
})

test("PUT with an http:// Woo URL is 400 before the tester runs", async () => {
  await start()
  const r = await call("PUT", "/internal/connections/woocommerce", { site_url: "http://woo.example.com" })
  expect(r.status).toBe(400)
  expect(r.json.error).toBe("invalid_input")
  expect(testWoo).not.toHaveBeenCalled()
})

test("PUT rejects non-string values and malformed JSON with 400", async () => {
  await start()
  const a = await call("PUT", "/internal/connections/shopify", { access_token: 5 })
  expect(a.status).toBe(400)
  expect(a.json.error).toBe("invalid_input")
  const b = await call("PUT", "/internal/connections/shopify", "{not json")
  expect(b.status).toBe(400)
  const c = await call("PUT", "/internal/connections/shopify", "[1]")
  expect(c.status).toBe(400)
})

test("PUT body over 64 KB is 413", async () => {
  await start()
  const r = await call("PUT", "/internal/connections/shopify", { access_token: "x".repeat(70_000) })
  expect(r.status).toBe(413)
  expect(manager.apply).not.toHaveBeenCalled()
})

test("amazon is not_supported on writes; unknown marketplace 404; wrong method 405", async () => {
  await start()
  for (const [m, p] of [
    ["PUT", "/internal/connections/amazon"],
    ["POST", "/internal/connections/amazon/test"],
    ["POST", "/internal/connections/amazon/link"],
    ["DELETE", "/internal/connections/amazon"],
  ] as const) {
    const r = await call(m, p, m === "PUT" ? {} : undefined)
    expect(r.status).toBe(400)
    expect(r.json).toEqual({ error: "not_supported" })
  }
  expect((await call("PUT", "/internal/connections/ebay", {})).status).toBe(404)
  expect((await call("GET", "/internal/other")).status).toBe(404)
  expect((await call("PATCH", "/internal/connections/shopify")).status).toBe(405)
  expect((await call("GET", "/internal/connections/shopify/link")).status).toBe(405)
})

test("POST test tests stored credentials and records status", async () => {
  await start()
  testShopify.mockResolvedValueOnce({ ok: false, message: "credentials rejected" })
  const r = await call("POST", "/internal/connections/shopify/test")
  expect(r.json).toEqual({ ok: false, message: "credentials rejected" })
  expect(testShopify.mock.calls[0]![0].accessToken).toBe(SHOPIFY_TOKEN)
  const row = rows.find((x) => x.marketplace === "shopify")!
  expect(row.status).toBe("error")
  expect(row.last_error).toBe("credentials rejected")
  const ok = await call("POST", "/internal/connections/shopify/test")
  expect(ok.json.ok).toBe(true)
  expect(row.status).toBe("connected")
})

test("link returns counts, and 409 when not running", async () => {
  await start()
  const r = await call("POST", "/internal/connections/shopify/link")
  expect(r.status).toBe(200)
  expect(r.json).toEqual({ linked: 3, already_linked: 1, unmatched: 2, duplicates: 1 })
  const n = await call("POST", "/internal/connections/woocommerce/link")
  expect(n.status).toBe(409)
})

test("DELETE stops, clears and reports env_fallback", async () => {
  await start()
  const r = await call("DELETE", "/internal/connections/shopify")
  expect(r.json).toEqual({ ok: true, env_fallback: false })
  expect(manager.stop).toHaveBeenCalledWith("shopify")
  expect(rows.find((x) => x.marketplace === "shopify")!.status).toBe("disconnected")
  await start({
    SHOPIFY_SHOP_DOMAIN: "e.myshopify.com",
    SHOPIFY_ACCESS_TOKEN: "t",
    SHOPIFY_WEBHOOK_SECRET: "w",
    SHOPIFY_LOCATION_ID: "1",
  } as NodeJS.ProcessEnv)
  const e = await call("DELETE", "/internal/connections/shopify")
  expect(e.json).toEqual({ ok: true, env_fallback: true })
})
