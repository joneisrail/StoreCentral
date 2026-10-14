import type { Pool } from "pg"
import { SCHEMA_SQL } from "./schema.js"

/**
 * Applies the `seller_hub` schema DDL to the given pool. The schema only
 * uses `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, so this
 * is naturally idempotent and safe to call on every boot.
 */
export const runMigrations = async (pool: Pool): Promise<void> => {
  await pool.query(SCHEMA_SQL)
}
