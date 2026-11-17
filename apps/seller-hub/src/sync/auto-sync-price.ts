import type { Pool } from "pg"

/**
 * Reads `integration_account.auto_sync_price` at event time (never cached, so a
 * toggle takes effect on the next event). A missing row counts as off; a
 * throwing query is handled by the webhook router, which falls back to off.
 */
export const readAutoSyncPrice = async (
  pool: Pool,
  integrationAccountId: string
): Promise<boolean> => {
  const { rows } = await pool.query<{ auto_sync_price: boolean }>(
    `SELECT auto_sync_price FROM seller_hub.integration_account WHERE id = $1`,
    [integrationAccountId]
  )
  return rows[0]?.auto_sync_price === true
}
