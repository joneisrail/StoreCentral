import { expect, test } from "vitest"
import type { Pool } from "pg"
import { encrypt } from "../crypto/secret-box.js"
import { SCHEMA_SQL } from "../db/schema.js"
import {
  ConnectionInputError,
  clearConnectionById,
  createConnectionRow,
  listConnectionRows,
  loadStoredConfig,
  mergeAmazonInput,
  mergeShopifyInput,
  mergeWooInput,
  resolveLegacyConfig,
  saveConnectionById,
  setStatusById,
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

/**
 * Stateful in-memory pool for the id-based functions. Recognises statements by
 * a fragment of their SQL; a unique violation is emulated for sales channels.
 */
const idPool = (seed: Row[] = []) => {
  const rows: Row[] = [...seed]
  const calls: { sql: string; params: unknown[] }[] = []
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (/^\s*INSERT/i.test(sql)) {
        const [marketplace, channel, name] = params as string[]
        if (rows.some((r) => r.medusa_sales_channel_id === channel)) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" })
        }
        const row: Row = {
          id: `id-${rows.length + 1}`,
          marketplace: marketplace!,
          medusa_sales_channel_id: channel,
          display_name: name,
          managed: true,
          status: "disconnected",
        }
        rows.push(row)
        return { rows: [{ id: row.id }] }
      }
      if (/^\s*UPDATE/i.test(sql)) {
        const row = rows.find((r) => r.id === params[params.length - 1])
        if (!row) return { rows: [] }
        const setClause = /SET\s+(.*?)\s+WHERE/is.exec(sql)![1]!
        for (const m of setClause.matchAll(/(\w+)\s*=\s*(\$\d+|NULL|'[^']*')/g)) {
          const v = m[2]!
          row[m[1]!] =
            v === "NULL" ? null : v.startsWith("$") ? params[Number(v.slice(1)) - 1] : v.replace(/'/g, "")
        }
        return { rows: [] }
      }
      if (/linked_listings/.test(sql)) {
        return {
          rows: rows.map((r) => ({
            ...r,
            medusa_sales_channel_id: r.medusa_sales_channel_id ?? null,
            linked_listings: "0",
            has_stored_credentials: r.webhook_secret_encrypted != null,
            api_key_present: r.api_key != null,
          })),
        }
      }
      if (/WHERE medusa_sales_channel_id = \$1/.test(sql)) {
        return { rows: rows.filter((r) => r.medusa_sales_channel_id === params[0]).map((r) => ({ id: r.id })) }
      }
      if (/WHERE id = \$1/.test(sql)) {
        return { rows: rows.filter((r) => r.id === params[0]) }
      }
      if (/WHERE marketplace = \$1/.test(sql)) {
        return { rows: rows.filter((r) => r.marketplace === params[0]) }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, rows, calls }
}

const amazon = { sellerId: "A1SELLER", marketplaceId: "ATVPDKIKX0DER", refreshToken: "Atzr|amazon_refresh_secret" }

test("createConnectionRow rejects a sales channel that already has a connection", async () => {
  const { pool, rows } = idPool()
  const id = await createConnectionRow(pool, { marketplace: "shopify", salesChannelId: "sc_1", displayName: "Main" })
  expect(rows[0]).toMatchObject({ id, managed: true, status: "disconnected", display_name: "Main" })
  await expect(
    createConnectionRow(pool, { marketplace: "woocommerce", salesChannelId: "sc_1", displayName: "Other" })
  ).rejects.toMatchObject({ name: "ConnectionInputError", fields: ["sales_channel_id"] })
  expect(rows).toHaveLength(1)
})

test("loadStoredConfig returns null for a row without credentials", async () => {
  const { pool } = idPool()
  const id = await createConnectionRow(pool, { marketplace: "shopify", salesChannelId: "sc_1", displayName: "A" })
  expect(await loadStoredConfig(pool, KEY, id)).toBeNull()
  expect(await loadStoredConfig(pool, KEY, "missing")).toBeNull()
})

test("loadStoredConfig throws on undecryptable ciphertext", async () => {
  const { pool } = idPool([{ ...shopifyRow(true), id: "bad", access_token_encrypted: "not:valid:cipher" }])
  await expect(loadStoredConfig(pool, KEY, "bad")).rejects.toThrow()
  const wrongKey = idPool([{ ...shopifyRow(true), id: "k" }])
  await expect(loadStoredConfig(wrongKey.pool, "cd".repeat(32), "k")).rejects.toThrow()
})

test("two shopify rows coexist and save independently", async () => {
  const { pool, rows, calls } = idPool()
  const a = await createConnectionRow(pool, { marketplace: "shopify", salesChannelId: "sc_a", displayName: "A" })
  const b = await createConnectionRow(pool, { marketplace: "shopify", salesChannelId: "sc_b", displayName: "B" })
  await saveConnectionById(pool, KEY, a, shopify, "connected", null)
  expect(await loadStoredConfig(pool, KEY, b)).toBeNull()
  const other = { ...shopify, shopDomain: "two.myshopify.com", accessToken: "shpat_second" }
  await saveConnectionById(pool, KEY, b, other, "error", "boom")
  expect(await loadStoredConfig(pool, KEY, a)).toEqual(shopify)
  expect(await loadStoredConfig(pool, KEY, b)).toEqual(other)
  expect(rows.find((r) => r.id === b)).toMatchObject({ status: "error", last_error: "boom" })
  expect(rows.find((r) => r.id === a)).toMatchObject({ status: "connected" })
  const all = JSON.stringify(calls.flatMap((c) => c.params))
  for (const secret of [SHOPIFY_TOKEN, SHOPIFY_WH, "shpat_second"]) expect(all).not.toContain(secret)
})

test("saveConnectionById stores woocommerce and amazon credentials", async () => {
  const { pool, calls } = idPool()
  const w = await createConnectionRow(pool, { marketplace: "woocommerce", salesChannelId: "sc_w", displayName: "W" })
  const z = await createConnectionRow(pool, { marketplace: "amazon", salesChannelId: "sc_z", displayName: "Z" })
  await saveConnectionById(pool, KEY, w, woo, "connected", null)
  await saveConnectionById(pool, KEY, z, amazon, "connected", null)
  expect(await loadStoredConfig(pool, KEY, w)).toEqual(woo)
  expect(await loadStoredConfig(pool, KEY, z)).toEqual(amazon)
  expect(JSON.stringify(calls.flatMap((c) => c.params))).not.toContain(amazon.refreshToken)
})

test("clearConnectionById keeps the sales channel link and listings", async () => {
  const { pool, rows, calls } = idPool()
  const id = await createConnectionRow(pool, { marketplace: "shopify", salesChannelId: "sc_1", displayName: "A" })
  await saveConnectionById(pool, KEY, id, shopify, "connected", null)
  calls.length = 0
  await clearConnectionById(pool, id)
  expect(rows[0]).toMatchObject({
    id,
    shop_domain: null,
    access_token_encrypted: null,
    webhook_secret_encrypted: null,
    medusa_sales_channel_id: "sc_1",
    display_name: "A",
    status: "disconnected",
    last_error: null,
  })
  expect(calls.every((c) => !/channel_listing|DELETE/i.test(c.sql))).toBe(true)
  expect(await loadStoredConfig(pool, KEY, id)).toBeNull()
})

test("setStatusById updates one row", async () => {
  const { pool, rows } = idPool([
    { id: "a", marketplace: "shopify" },
    { id: "b", marketplace: "shopify" },
  ])
  await setStatusById(pool, "b", "error", "bad")
  expect(rows[1]).toMatchObject({ status: "error", last_error: "bad" })
  expect(rows[0]!.status).toBeUndefined()
})

test("resolveLegacyConfig is used only when no managed row exists for the marketplace", async () => {
  const empty = idPool()
  expect((await resolveLegacyConfig(empty.pool, KEY, "shopify", env))?.source).toBe("environment")
  const managed = idPool([{ id: "m1", marketplace: "shopify", managed: true }])
  expect(await resolveLegacyConfig(managed.pool, KEY, "shopify", env)).toBeNull()
  expect(await resolveLegacyConfig(managed.pool, KEY, "woocommerce", NO_ENV)).toBeNull()
  const legacy = idPool([{ ...shopifyRow(false), managed: false }])
  expect((await resolveLegacyConfig(legacy.pool, KEY, "shopify", env))?.source).toBe("environment")
  expect(await resolveLegacyConfig(legacy.pool, KEY, "amazon", env)).toBeNull()
})

test("mergeAmazonInput defaults the marketplace id and requires seller id and refresh token", () => {
  expect(mergeAmazonInput(null, { sellerId: " S1 ", refreshToken: "tok" })).toEqual({
    sellerId: "S1",
    marketplaceId: "ATVPDKIKX0DER",
    refreshToken: "tok",
  })
  expect(mergeAmazonInput(amazon, { marketplaceId: "A2EUQ1WTGCTBG2" })).toEqual({
    ...amazon,
    marketplaceId: "A2EUQ1WTGCTBG2",
  })
  try {
    mergeAmazonInput(null, { marketplaceId: "X" })
    throw new Error("should have thrown")
  } catch (e) {
    expect(e).toBeInstanceOf(ConnectionInputError)
    expect((e as ConnectionInputError).fields).toEqual(["sellerId", "refreshToken"])
  }
})

test("listConnectionRows returns ids, names and managed flags without secrets", async () => {
  const { pool } = idPool([{ ...shopifyRow(true), id: "s1", managed: true, display_name: "Shop" }])
  const [row] = await listConnectionRows(pool)
  expect(row).toMatchObject({ id: "s1", displayName: "Shop", managed: true, hasStoredCredentials: true })
  expect(JSON.stringify(row)).not.toContain(SHOPIFY_TOKEN)
})

test("listConnectionRows selects no secret column and orders managed first", async () => {
  const { pool, calls } = idPool()
  await listConnectionRows(pool)
  const sql = calls[0]!.sql
  expect(sql).toMatch(/ORDER BY a\.managed DESC, a\.created_at/)
  expect(sql).toMatch(/lwa_refresh_token_encrypted IS NOT NULL/)
  const selectList = sql
    .slice(0, sql.indexOf("FROM seller_hub.integration_account a"))
    .replace(/[a-z_.]+ IS NOT NULL/g, "")
  expect(selectList).not.toMatch(/access_token_encrypted|webhook_secret_encrypted|lwa_refresh_token_encrypted/)
})

test("backfill marks rows with a webhook secret as managed", () => {
  expect(SCHEMA_SQL).toMatch(
    /UPDATE seller_hub\.integration_account SET managed = true\s+WHERE webhook_secret_encrypted IS NOT NULL AND managed = false;/
  )
  expect(SCHEMA_SQL).toContain(
    "ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT false;"
  )
  expect(SCHEMA_SQL).toMatch(
    /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON seller_hub\.integration_account \(medusa_sales_channel_id\)\s+WHERE medusa_sales_channel_id IS NOT NULL;/
  )
  for (const col of ["display_name", "amazon_seller_id", "amazon_marketplace_id"]) {
    expect(SCHEMA_SQL).toContain(
      `ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS ${col} TEXT;`
    )
  }
  // Running the schema twice is safe: every DDL statement is guarded and the
  // only DML (the backfill) only touches rows that are not yet managed.
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.replace(/^(\s*--.*\n)+/g, "").trim())
    .filter(Boolean)
  for (const st of statements) {
    expect(st).toMatch(
      /IF NOT EXISTS|^UPDATE seller_hub\.integration_account SET (managed = true|medusa_sales_channel_id = NULL)/
    )
  }
})

test("schema UPDATE statements are all self-limiting so a second run changes nothing", () => {
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.replace(/^(\s*--.*\n)+/g, "").trim())
    .filter(Boolean)
  const updates = statements.filter((s) => /^UPDATE/.test(s))
  expect(updates).toHaveLength(2)
  for (const u of updates) expect(u).toMatch(/WHERE/)
  expect(updates[0]).toMatch(/AND managed = false/)
  expect(updates[1]).toMatch(/rn > 1/)
})

test("the dedupe runs after the backfill and before the unique index", () => {
  const column = SCHEMA_SQL.indexOf("ADD COLUMN IF NOT EXISTS managed")
  const backfill = SCHEMA_SQL.indexOf("SET managed = true")
  const dedupe = SCHEMA_SQL.indexOf("SET medusa_sales_channel_id = NULL")
  const index = SCHEMA_SQL.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS integration_account_sales_channel_uq")
  expect(column).toBeGreaterThan(-1)
  expect(backfill).toBeGreaterThan(column)
  expect(dedupe).toBeGreaterThan(backfill)
  expect(index).toBeGreaterThan(dedupe)
  expect(SCHEMA_SQL).toMatch(
    /PARTITION BY medusa_sales_channel_id ORDER BY created_at, id\) AS rn[\s\S]*?WHERE medusa_sales_channel_id IS NOT NULL[\s\S]*?WHERE rn > 1/
  )
})

test("loadStoredConfig returns null for an amazon row without a seller id", async () => {
  const { pool } = idPool([
    { id: "z1", marketplace: "amazon", lwa_refresh_token_encrypted: encrypt("tok", KEY), amazon_seller_id: null },
  ])
  expect(await loadStoredConfig(pool, KEY, "z1")).toBeNull()
})
