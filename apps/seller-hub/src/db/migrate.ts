import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Pool } from "pg"

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "schema.sql")

/**
 * Applies `schema.sql` to the given pool. The schema only uses
 * `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, so this is
 * naturally idempotent and safe to call on every boot.
 */
export const runMigrations = async (pool: Pool): Promise<void> => {
  const sql = readFileSync(SCHEMA_PATH, "utf-8")
  await pool.query(sql)
}
