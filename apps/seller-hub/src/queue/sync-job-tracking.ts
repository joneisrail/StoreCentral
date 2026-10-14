import type { Pool } from "pg"

/**
 * Marks a `seller_hub.sync_job` row `failed` and records the error that
 * caused it. Thin wrapper shared by every worker task (product, inventory,
 * price, order sync) so job-outcome bookkeeping isn't duplicated per
 * worker.
 */
export const markSyncJobFailed = async (
  pool: Pool,
  syncJobId: string,
  error: string
): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.sync_job
     SET status = 'failed', last_error = $1, updated_at = now()
     WHERE id = $2`,
    [error, syncJobId]
  )
}

/**
 * Marks a `seller_hub.sync_job` row `succeeded`, records the created/updated
 * Medusa entity id (when there is one), and clears any `last_error` left
 * over from a prior failed attempt.
 */
export const markSyncJobSucceeded = async (
  pool: Pool,
  syncJobId: string,
  medusaEntityId?: string
): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.sync_job
     SET status = 'succeeded', medusa_entity_id = $1, last_error = NULL, updated_at = now()
     WHERE id = $2`,
    [medusaEntityId ?? null, syncJobId]
  )
}
