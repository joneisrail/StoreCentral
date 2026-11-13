import { expect, test } from "vitest"
import type { Pool } from "pg"
import { decrypt } from "../crypto/secret-box.js"
import { resolveShopifyAccount } from "./account.js"
import type { ShopifyConfig } from "./config.js"

const KEY = "ab".repeat(32)
const config: ShopifyConfig = {
  shopDomain: "shop.myshopify.com",
  accessToken: "shpat_secret_token",
  webhookSecret: "whsec",
  locationId: "123",
}

type Row = { id: string; marketplace: string; shop_domain?: string; shopify_location_id?: string; access_token_encrypted?: string; status?: string }

const fakePool = () => {
  const rows: Row[] = []
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: rows.filter((r) => r.marketplace === "shopify").slice(0, 1) }
      }
      if (/^\s*INSERT/i.test(sql)) {
        const row: Row = {
          id: `id-${rows.length + 1}`,
          marketplace: "shopify",
          shop_domain: params[0] as string,
          shopify_location_id: params[1] as string,
          access_token_encrypted: params[2] as string,
          status: "connected",
        }
        rows.push(row)
        return { rows: [row] }
      }
      if (/^\s*UPDATE/i.test(sql)) {
        const row = rows.find((r) => r.id === params[3])!
        row.shop_domain = params[0] as string
        row.shopify_location_id = params[1] as string
        row.access_token_encrypted = params[2] as string
        row.status = "connected"
        return { rows: [row] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, rows }
}

test("creates one row, is idempotent, and stores only the encrypted token", async () => {
  const { pool, rows } = fakePool()
  const a = await resolveShopifyAccount(pool, config, KEY)
  const b = await resolveShopifyAccount(pool, config, KEY)
  expect(b.id).toBe(a.id)
  expect(rows).toHaveLength(1)
  expect(a).toEqual({ id: a.id, shopDomain: "shop.myshopify.com", locationId: "123" })
  const stored = rows[0]!.access_token_encrypted!
  expect(stored).not.toBe(config.accessToken)
  expect(stored).not.toContain(config.accessToken)
  expect(decrypt(stored, KEY)).toBe(config.accessToken)
  expect(rows[0]!.status).toBe("connected")
})
