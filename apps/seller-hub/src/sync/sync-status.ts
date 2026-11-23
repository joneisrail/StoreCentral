import type { Pool } from "pg"
import { sanitizeSyncError } from "../medusa/admin-client.js"

export type SyncKind = "product" | "inventory" | "price" | "order" | "tracking"

export type SyncStatusData = {
  connection: { status: string; last_error: string | null; last_synced_at: string | null }
  listings: { total: number; by_status: Record<string, number>; with_error: number; never_pushed: number }
  jobs: {
    by_type: Record<string, { pending: number; processing: number; failed: number; succeeded: number }>
    last_succeeded_at: Record<SyncKind, string | null>
  }
  recent_failures: {
    sync_type: string
    external_id: string
    attempts: number
    last_error: string | null
    updated_at: string
  }[]
  failures_total: number
}

export const SYNC_FAILURE_LIMIT = 25

const KINDS: SyncKind[] = ["product", "inventory", "price", "order", "tracking"]
const ERROR_CAP = 300

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const clean = (message: string | null): string | null =>
  message === null ? null : sanitizeSyncError(message).slice(0, ERROR_CAP)

/** Read-only sync health for one integration account. Null when it does not exist. */
export const getSyncStatus = async (pool: Pool, integrationAccountId: string): Promise<SyncStatusData | null> => {
  const account = await pool.query<{ status: string; last_error: string | null; last_synced_at: Date | null }>(
    `SELECT status, last_error, last_synced_at FROM seller_hub.integration_account WHERE id = $1`,
    [integrationAccountId]
  )
  const row = account.rows[0]
  if (!row) return null

  const [listingRows, jobRows, successRows, failureRows, failureCount] = await Promise.all([
    pool.query<{ status: string; total: string; with_error: string; never_pushed: string }>(
      `SELECT status,
              count(*) AS total,
              count(*) FILTER (WHERE last_error IS NOT NULL AND last_error <> '') AS with_error,
              count(*) FILTER (WHERE last_synced_quantity IS NULL) AS never_pushed
       FROM seller_hub.channel_listing WHERE integration_account_id = $1 GROUP BY status`,
      [integrationAccountId]
    ),
    pool.query<{ sync_type: string; status: string; n: string }>(
      `SELECT sync_type, status, count(*) AS n
       FROM seller_hub.sync_job WHERE integration_account_id = $1 GROUP BY sync_type, status`,
      [integrationAccountId]
    ),
    pool.query<{ sync_type: string; at: Date }>(
      `SELECT sync_type, max(updated_at) AS at
       FROM seller_hub.sync_job WHERE integration_account_id = $1 AND status = 'succeeded' GROUP BY sync_type`,
      [integrationAccountId]
    ),
    pool.query<{ sync_type: string; external_id: string; attempts: number; last_error: string | null; updated_at: Date }>(
      `SELECT sync_type, external_id, attempts, last_error, updated_at
       FROM seller_hub.sync_job WHERE integration_account_id = $1 AND status = 'failed'
       ORDER BY updated_at DESC, external_id DESC LIMIT $2`,
      [integrationAccountId, SYNC_FAILURE_LIMIT]
    ),
    pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM seller_hub.sync_job WHERE integration_account_id = $1 AND status = 'failed'`,
      [integrationAccountId]
    ),
  ])

  const by_status: Record<string, number> = {}
  let total = 0
  let with_error = 0
  let never_pushed = 0
  for (const r of listingRows.rows) {
    by_status[r.status] = Number(r.total)
    total += Number(r.total)
    with_error += Number(r.with_error)
    never_pushed += Number(r.never_pushed)
  }

  const by_type: SyncStatusData["jobs"]["by_type"] = {}
  for (const kind of KINDS) by_type[kind] = { pending: 0, processing: 0, failed: 0, succeeded: 0 }
  for (const r of jobRows.rows) {
    const bucket = by_type[r.sync_type]
    if (bucket && r.status in bucket) bucket[r.status as keyof typeof bucket] = Number(r.n)
  }

  const last_succeeded_at = Object.fromEntries(KINDS.map((k) => [k, null])) as Record<SyncKind, string | null>
  for (const r of successRows.rows) {
    if ((KINDS as string[]).includes(r.sync_type)) last_succeeded_at[r.sync_type as SyncKind] = iso(r.at)
  }

  return {
    connection: { status: row.status, last_error: clean(row.last_error), last_synced_at: iso(row.last_synced_at) },
    listings: { total, by_status, with_error, never_pushed },
    jobs: { by_type, last_succeeded_at },
    recent_failures: failureRows.rows.map((r) => ({
      sync_type: r.sync_type,
      external_id: r.external_id,
      attempts: r.attempts,
      last_error: clean(r.last_error),
      updated_at: iso(r.updated_at)!,
    })),
    failures_total: Number(failureCount.rows[0]!.n),
  }
}
