import type { Pool } from "pg"

/**
 * Optional fencing condition for `markSyncJobFailed`/`markSyncJobSucceeded`.
 *
 * When given, the UPDATE only applies if the row is still `processing` at
 * exactly this `attempts` value -- i.e. only if the caller still holds the
 * claim it took. Order import (`sync/import-order.ts`) needs this because
 * its rows can be reclaimed out from under a stalled caller (the stale
 * `processing` reclaim); without the fence, a stalled caller that finally
 * finishes could overwrite a newer attempt's outcome. Callers whose claim is
 * never taken away from them (the `push-*.ts` flows) omit it.
 */
export type SyncJobFence = { attempts: number }

/**
 * Marks a `seller_hub.sync_job` row `failed` and records the error that
 * caused it. Thin wrapper shared by every worker task (product, inventory,
 * price, order sync) so job-outcome bookkeeping isn't duplicated per
 * worker.
 *
 * Resolves `true` if the row was updated, `false` if a `fence` was given
 * and no longer matched (the caller lost its claim).
 */
export const markSyncJobFailed = async (
  pool: Pool,
  syncJobId: string,
  error: string,
  fence?: SyncJobFence
): Promise<boolean> => {
  const { rowCount } = fence
    ? await pool.query(
        `UPDATE seller_hub.sync_job
         SET status = 'failed', last_error = $1, updated_at = now()
         WHERE id = $2 AND status = 'processing' AND attempts = $3`,
        [error, syncJobId, fence.attempts]
      )
    : await pool.query(
        `UPDATE seller_hub.sync_job
         SET status = 'failed', last_error = $1, updated_at = now()
         WHERE id = $2`,
        [error, syncJobId]
      )
  return (rowCount ?? 0) > 0
}

/**
 * Marks a `seller_hub.sync_job` row `succeeded`, records the created/updated
 * Medusa entity id (when there is one), and clears any `last_error` left
 * over from a prior failed attempt.
 *
 * Resolves `true` if the row was updated, `false` if a `fence` was given
 * and no longer matched (the caller lost its claim).
 */
export const markSyncJobSucceeded = async (
  pool: Pool,
  syncJobId: string,
  medusaEntityId?: string,
  fence?: SyncJobFence
): Promise<boolean> => {
  const { rowCount } = fence
    ? await pool.query(
        `UPDATE seller_hub.sync_job
         SET status = 'succeeded', medusa_entity_id = $1, last_error = NULL, updated_at = now()
         WHERE id = $2 AND status = 'processing' AND attempts = $3`,
        [medusaEntityId ?? null, syncJobId, fence.attempts]
      )
    : await pool.query(
        `UPDATE seller_hub.sync_job
         SET status = 'succeeded', medusa_entity_id = $1, last_error = NULL, updated_at = now()
         WHERE id = $2`,
        [medusaEntityId ?? null, syncJobId]
      )
  return (rowCount ?? 0) > 0
}
