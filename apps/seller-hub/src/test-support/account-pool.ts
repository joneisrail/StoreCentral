import { randomUUID } from "node:crypto"
import type { Pool } from "pg"

export type AccountRow = Record<string, unknown> & { id: string; marketplace: string }

const CREDENTIAL_COLUMNS = [
  "shop_domain",
  "access_token_encrypted",
  "api_key",
  "shopify_location_id",
  "webhook_secret_encrypted",
  "lwa_refresh_token_encrypted",
  "amazon_seller_id",
  "amazon_marketplace_id",
]

/**
 * In-memory pool for tests: recognises the handful of integration_account
 * statements connectors/credentials.ts runs, keyed by row id.
 */
export const accountPool = (seed: AccountRow[] = []) => {
  const rows: AccountRow[] = [...seed]
  const calls: { sql: string; params: unknown[] }[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (/^\s*INSERT/i.test(sql)) {
      const row: AccountRow = { id: randomUUID(), marketplace: "" }
      const cols = /\(([^)]*)\)\s*VALUES/is.exec(sql)![1]!.split(",").map((c) => c.trim())
      const values = /VALUES\s*\((.*)\)/is.exec(sql)![1]!.split(",").map((v) => v.trim())
      cols.forEach((c, i) => {
        const v = values[i]!
        if (v.startsWith("$")) row[c] = params[Number(v.slice(1)) - 1]
        else if (v === "true" || v === "false") row[c] = v === "true"
        else row[c] = v.replace(/'/g, "")
      })
      row.marketplace = String(row.marketplace)
      rows.push(row)
      return { rows: [{ id: row.id }] }
    }
    if (/^\s*DELETE/i.test(sql)) {
      const i = rows.findIndex((r) => r.id === params[0])
      if (i >= 0) rows.splice(i, 1)
      return { rows: [] }
    }
    if (/^\s*UPDATE/i.test(sql)) {
      const row = rows.find((r) => r.id === params[params.length - 1])
      if (!row) return { rows: [] }
      if (/shop_domain\s*=\s*NULL/i.test(sql)) {
        for (const c of CREDENTIAL_COLUMNS) row[c] = null
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
        const ordered = [...rows.filter((r) => r.managed), ...rows.filter((r) => !r.managed)]
        return {
          rows: ordered.map((r) => ({
            id: r.id,
            display_name: r.display_name ?? null,
            managed: Boolean(r.managed),
            amazon_seller_id: r.amazon_seller_id ?? null,
            amazon_marketplace_id: r.amazon_marketplace_id ?? null,
            marketplace: r.marketplace,
            status: r.status ?? "disconnected",
            last_error: r.last_error ?? null,
            last_synced_at: null,
            medusa_sales_channel_id: r.medusa_sales_channel_id ?? null,
            linked_listings: "2",
            has_stored_credentials:
              r.marketplace === "amazon"
                ? r.lwa_refresh_token_encrypted != null
                : r.webhook_secret_encrypted != null,
            shop_domain: r.shop_domain ?? null,
            shopify_location_id: r.shopify_location_id ?? null,
            api_key_present: r.api_key != null,
          })),
        }
      }
      if (/WHERE medusa_sales_channel_id = \$1/.test(sql)) {
        return { rows: rows.filter((r) => r.medusa_sales_channel_id === params[0]).slice(0, 1) }
      }
      if (/SELECT\s+managed/i.test(sql)) {
        return {
          rows: rows
            .filter((r) => r.marketplace === params[0])
            .map((r) => ({ ...r, managed: Boolean(r.managed) })),
        }
      }
      return { rows: rows.filter((r) => r.id === params[0]).slice(0, 1) }
    }
    throw new Error(`unexpected sql: ${sql}`)
  }
  return { pool: { query } as unknown as Pool, rows, calls }
}
