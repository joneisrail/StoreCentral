import { expect, test } from "vitest"
import { Pool } from "pg"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { runMigrations } from "./migrate.js"
import { SCHEMA_SQL } from "./schema.js"

test("schema adds the Shopify columns idempotently", () => {
  const expected = [
    ["integration_account", "shop_domain"],
    ["integration_account", "access_token_encrypted"],
    ["integration_account", "shopify_location_id"],
    ["channel_listing", "external_variant_id"],
    ["channel_listing", "external_inventory_item_id"],
  ]
  for (const [table, col] of expected) {
    expect(SCHEMA_SQL).toContain(
      `ALTER TABLE seller_hub.${table} ADD COLUMN IF NOT EXISTS ${col} TEXT;`
    )
  }
})

test("schema adds the WooCommerce columns idempotently", () => {
  for (const [table, col] of [
    ["integration_account", "api_key"],
    ["channel_listing", "external_parent_id"],
  ]) {
    const stmt = `ALTER TABLE seller_hub.${table} ADD COLUMN IF NOT EXISTS ${col} TEXT;`
    expect(SCHEMA_SQL).toContain(stmt)
    expect(SCHEMA_SQL.split(stmt)).toHaveLength(2)
  }
})

test("schema adds the marketplace connection columns idempotently", () => {
  for (const col of ["medusa_sales_channel_id", "webhook_secret_encrypted", "last_error"]) {
    const stmt = `ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS ${col} TEXT;`
    expect(SCHEMA_SQL).toContain(stmt)
    expect(SCHEMA_SQL.split(stmt)).toHaveLength(2)
  }
})

test("amazon_settings table exists after runMigrations", async () => {
  const pool = new Pool({ connectionString: assertTestDatabase(process.env.TEST_DATABASE_URL) })
  try {
    await runMigrations(pool)
    const { rows } = await pool.query(`SELECT to_regclass('seller_hub.amazon_settings') AS t`)
    expect(rows[0].t).not.toBeNull()
  } finally {
    await pool.end()
  }
}, 30_000)

test("schema adds the per-connection auto_sync_price flag idempotently", () => {
  const stmt =
    "ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS auto_sync_price BOOLEAN NOT NULL DEFAULT false;"
  expect(SCHEMA_SQL).toContain(stmt)
  expect(SCHEMA_SQL.split(stmt)).toHaveLength(2)
})
