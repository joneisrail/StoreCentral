import { expect, test } from "vitest"
import type { Pool } from "pg"
import { encrypt } from "../crypto/secret-box.js"
import {
  ConnectionInputError,
  clearConnection,
  listConnectionRows,
  mergeShopifyInput,
  mergeWooInput,
  resolveShopifyConfig,
  resolveWooConfig,
  saveConnection,
  setConnectionStatus,
} from "./credentials.js"

const KEY = "ab".repeat(32)
const SHOPIFY_TOKEN = "shpat_super_secret_token"
const SHOPIFY_WH = "shopify_wh_secret_value"
const WOO_SECRET = "cs_super_secret_value"
const WOO_WH = "woo_wh_secret_value"
const NO_ENV = {} as NodeJS.ProcessEnv

const shopify = {
  shopDomain: "shop.myshopify.com",
  accessToken: SHOPIFY_TOKEN,
  webhookSecret: SHOPIFY_WH,
  locationId: "123",
}
const woo = {
  siteUrl: "https://woo.example.com",
  consumerKey: "ck_key",
  consumerSecret: WOO_SECRET,
  webhookSecret: WOO_WH,
}

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
        const marketplace = /VALUES\s*\(\s*'(\w+)'/i.exec(sql)?.[1]
        if (marketplace) row.marketplace = marketplace
        let p = 0
        const values = /VALUES\s*\((.*)\)/is.exec(sql)![1]!.split(",").map((v) => v.trim())
        cols.forEach((c, i) => {
          const v = values[i]!
          if (v.startsWith("$")) row[c] = params[Number(v.slice(1)) - 1]
          else row[c] = v.replace(/'/g, "")
          p++
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

const shopifyRow = (withWebhook: boolean): Row => ({
  id: "r1",
  marketplace: "shopify",
  shop_domain: shopify.shopDomain,
  shopify_location_id: shopify.locationId,
  access_token_encrypted: encrypt(SHOPIFY_TOKEN, KEY),
  webhook_secret_encrypted: withWebhook ? encrypt(SHOPIFY_WH, KEY) : null,
})

const env = {
  SHOPIFY_SHOP_DOMAIN: "env.myshopify.com",
  SHOPIFY_ACCESS_TOKEN: "envtok",
  SHOPIFY_WEBHOOK_SECRET: "envwh",
  SHOPIFY_LOCATION_ID: "9",
} as NodeJS.ProcessEnv

test("resolveShopifyConfig prefers a database row with a webhook secret", async () => {
  const { pool } = fakePool([shopifyRow(true)])
  const r = await resolveShopifyConfig(pool, KEY, env)
  expect(r?.source).toBe("database")
  expect(r?.config).toEqual(shopify)
})

test("resolveShopifyConfig falls back to env, then null", async () => {
  const { pool } = fakePool()
  const r = await resolveShopifyConfig(pool, KEY, env)
  expect(r?.source).toBe("environment")
  expect(r?.config.shopDomain).toBe("env.myshopify.com")
  expect(await resolveShopifyConfig(pool, KEY, NO_ENV)).toBeNull()
})

test("a row with a token but no webhook secret is not a database connection", async () => {
  const { pool } = fakePool([shopifyRow(false)])
  const r = await resolveShopifyConfig(pool, KEY, env)
  expect(r?.source).toBe("environment")
  expect(await resolveShopifyConfig(pool, KEY, NO_ENV)).toBeNull()
})

test("resolveWooConfig reads the database row and falls back to env", async () => {
  const { pool } = fakePool([
    {
      id: "w1",
      marketplace: "woocommerce",
      shop_domain: woo.siteUrl,
      api_key: woo.consumerKey,
      access_token_encrypted: encrypt(WOO_SECRET, KEY),
      webhook_secret_encrypted: encrypt(WOO_WH, KEY),
    },
  ])
  expect(await resolveWooConfig(pool, KEY, NO_ENV)).toEqual({ config: woo, source: "database" })
  const empty = fakePool()
  const wooEnv = {
    WOOCOMMERCE_SITE_URL: "https://e.example.com/",
    WOOCOMMERCE_CONSUMER_KEY: "k",
    WOOCOMMERCE_CONSUMER_SECRET: "s",
    WOOCOMMERCE_WEBHOOK_SECRET: "w",
  } as NodeJS.ProcessEnv
  expect((await resolveWooConfig(empty.pool, KEY, wooEnv))?.source).toBe("environment")
  expect(await resolveWooConfig(empty.pool, KEY, NO_ENV)).toBeNull()
})

test("mergeShopifyInput keeps stored values for blank fields", () => {
  const merged = mergeShopifyInput(shopify, {
    shopDomain: "  ",
    accessToken: "",
    webhookSecret: undefined,
    locationId: " 456 ",
  })
  expect(merged).toEqual({ ...shopify, locationId: "456" })
})

test("mergeShopifyInput lists every missing field when nothing is stored", () => {
  try {
    mergeShopifyInput(null, { shopDomain: "a.myshopify.com" })
    throw new Error("should have thrown")
  } catch (e) {
    expect(e).toBeInstanceOf(ConnectionInputError)
    expect((e as ConnectionInputError).fields).toEqual(["accessToken", "webhookSecret", "locationId"])
  }
})

test("mergeWooInput rejects http and strips trailing slashes", () => {
  const base = { consumerKey: "k", consumerSecret: "s", webhookSecret: "w" }
  try {
    mergeWooInput(null, { ...base, siteUrl: "http://woo.example.com" })
    throw new Error("should have thrown")
  } catch (e) {
    expect(e).toBeInstanceOf(ConnectionInputError)
    expect((e as ConnectionInputError).fields).toEqual(["siteUrl"])
  }
  expect(mergeWooInput(null, { ...base, siteUrl: "https://woo.example.com///" }).siteUrl).toBe(
    "https://woo.example.com"
  )
  expect(mergeWooInput(woo, {})).toEqual(woo)
})

test("saveConnection stores ciphertext only and upserts a single row", async () => {
  const { pool, rows, calls } = fakePool()
  await saveConnection(pool, KEY, "shopify", shopify, "sc_1")
  await saveConnection(pool, KEY, "shopify", shopify)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.medusa_sales_channel_id).toBe("sc_1")
  expect(rows[0]!.status).toBe("connected")
  expect(rows[0]!.webhook_secret_encrypted).toBeTruthy()
  await saveConnection(pool, KEY, "woocommerce", woo)
  expect(rows).toHaveLength(2)
  const all = JSON.stringify(calls.flatMap((c) => c.params))
  for (const secret of [SHOPIFY_TOKEN, SHOPIFY_WH, WOO_SECRET, WOO_WH]) {
    expect(all).not.toContain(secret)
  }
  expect(await resolveShopifyConfig(pool, KEY, NO_ENV)).toEqual({ config: shopify, source: "database" })
  expect(await resolveWooConfig(pool, KEY, NO_ENV)).toEqual({ config: woo, source: "database" })
})

test("clearConnection nulls the credentials and disconnects", async () => {
  const { pool, rows } = fakePool([shopifyRow(true)])
  await clearConnection(pool, "shopify")
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    shop_domain: null,
    access_token_encrypted: null,
    webhook_secret_encrypted: null,
    status: "disconnected",
    last_error: null,
  })
})

test("setConnectionStatus updates status and last error", async () => {
  const { pool, rows } = fakePool([shopifyRow(true)])
  await setConnectionStatus(pool, "shopify", "error", "boom")
  expect(rows[0]).toMatchObject({ status: "error", last_error: "boom" })
})

test("listConnectionRows never exposes secrets", async () => {
  const { pool } = fakePool([shopifyRow(true)])
  const list = await listConnectionRows(pool)
  expect(list[0]).toMatchObject({
    marketplace: "shopify",
    hasStoredCredentials: true,
    linkedListings: 2,
    shopDomain: "shop.myshopify.com",
    apiKeyPresent: false,
  })
  const json = JSON.stringify(list)
  for (const secret of [SHOPIFY_TOKEN, SHOPIFY_WH]) expect(json).not.toContain(secret)
})
