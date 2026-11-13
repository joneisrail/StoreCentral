import { expect, test } from "vitest"
import type { Pool } from "pg"
import { decrypt } from "../crypto/secret-box.js"
import { resolveWooCommerceAccount } from "./account.js"
import type { WooCommerceConfig } from "./config.js"

const KEY = "ab".repeat(32)
const config: WooCommerceConfig = {
  siteUrl: "https://shop.example.com",
  consumerKey: "ck_key",
  consumerSecret: "cs_secret_value",
  webhookSecret: "whsec",
}

type Row = { id: string; marketplace: string; shop_domain?: string; api_key?: string; access_token_encrypted?: string; status?: string }

const fakePool = () => {
  const rows: Row[] = []
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: rows.filter((r) => r.marketplace === "woocommerce").slice(0, 1) }
      }
      if (/^\s*INSERT/i.test(sql)) {
        const row: Row = {
          id: `id-${rows.length + 1}`,
          marketplace: "woocommerce",
          shop_domain: params[0] as string,
          api_key: params[1] as string,
          access_token_encrypted: params[2] as string,
          status: "connected",
        }
        rows.push(row)
        return { rows: [row] }
      }
      if (/^\s*UPDATE/i.test(sql)) {
        const row = rows.find((r) => r.id === params[3])!
        row.shop_domain = params[0] as string
        row.api_key = params[1] as string
        row.access_token_encrypted = params[2] as string
        row.status = "connected"
        return { rows: [row] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, rows }
}

test("creates one row, is idempotent, and stores only the encrypted secret", async () => {
  const { pool, rows } = fakePool()
  const a = await resolveWooCommerceAccount(pool, config, KEY)
  const b = await resolveWooCommerceAccount(pool, config, KEY)
  expect(b.id).toBe(a.id)
  expect(rows).toHaveLength(1)
  expect(a).toEqual({ id: a.id, siteUrl: "https://shop.example.com" })
  expect(rows[0]!.api_key).toBe("ck_key")
  const stored = rows[0]!.access_token_encrypted!
  expect(stored).not.toContain(config.consumerSecret)
  expect(decrypt(stored, KEY)).toBe(config.consumerSecret)
  expect(rows[0]!.status).toBe("connected")
})
