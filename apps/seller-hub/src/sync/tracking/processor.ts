import type { Pool } from "pg"
import type { MedusaAdminClient } from "../../medusa/admin-client.js"
import { DeferSyncError, PermanentSyncError } from "../../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../../queue/sync-job-tracking.js"
import { STALE_PROCESSING_MS } from "../import-order.js"
import { resolveTrackingTarget } from "./resolve.js"
import type { TrackingJobData, TrackingPush } from "./types.js"

export type TrackingProcessorDeps = {
  pool: Pool
  medusaClient: Pick<MedusaAdminClient, "getOrderForTracking">
  integrationAccountId: string
  marketplace: "shopify" | "woocommerce"
  push: TrackingPush
  /** Defaults to `STALE_PROCESSING_MS`; overridable for tests. */
  staleProcessingMs?: number
}

export type TrackingJobResult = { status: "pushed" | "skipped" | "recovered" }

type Claim =
  | { kind: "claimed"; syncJobId: string; attempts: number }
  | { kind: "already_succeeded" }
  | { kind: "in_progress"; leaseExpiresAt: number }

const claimTrackingSyncJob = async (
  pool: Pool,
  integrationAccountId: string,
  fulfillmentId: string,
  staleProcessingMs: number
): Promise<Claim> => {
  const inserted = await pool.query<{ id: string; attempts: number }>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'tracking', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id) DO NOTHING
     RETURNING id, attempts`,
    [integrationAccountId, fulfillmentId]
  )
  if (inserted.rows[0]) {
    return { kind: "claimed", syncJobId: inserted.rows[0].id, attempts: inserted.rows[0].attempts }
  }
  for (let i = 0; i < 3; i++) {
    const reclaimed = await pool.query<{ id: string; attempts: number }>(
      `UPDATE seller_hub.sync_job
       SET status = 'processing', attempts = attempts + 1, updated_at = now()
       WHERE integration_account_id = $1 AND sync_type = 'tracking' AND external_id = $2
         AND (
           status IN ('failed', 'pending')
           OR (status = 'processing'
               AND updated_at < now() - ($3::float8 * interval '1 millisecond'))
         )
       RETURNING id, attempts`,
      [integrationAccountId, fulfillmentId, staleProcessingMs]
    )
    if (reclaimed.rows[0]) {
      return { kind: "claimed", syncJobId: reclaimed.rows[0].id, attempts: reclaimed.rows[0].attempts }
    }
    const current = await pool.query<{ status: string; lease_expires_at: number }>(
      `SELECT status,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::float8 + $3::float8 AS lease_expires_at
       FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'tracking' AND external_id = $2`,
      [integrationAccountId, fulfillmentId, staleProcessingMs]
    )
    const row = current.rows[0]
    if (row?.status === "succeeded") return { kind: "already_succeeded" }
    if (row?.status === "processing") {
      return { kind: "in_progress", leaseExpiresAt: row.lease_expires_at }
    }
  }
  throw new Error("Could not claim tracking sync_job: row kept changing state under contention")
}

const extractHttpStatus = (message: string): number | null => {
  const statusKeyword = message.match(/status\s+(\d{3})\b/i)
  if (statusKeyword) return Number(statusKeyword[1])
  const leadingCode = message.match(/^(\d{3}):/)
  if (leadingCode) return Number(leadingCode[1])
  return null
}

/**
 * Turns any thrown value into a log/DB/BullMQ-safe error: the error class and
 * an HTTP status when one is recognisable -- never the original message, which
 * may carry URLs, tracking numbers or response bodies. A 4xx other than 429
 * (and a `PermanentSyncError`) is permanent; everything else is transient.
 */
const sanitizeError = (err: unknown): Error => {
  const kind = err instanceof Error ? err.constructor.name : typeof err
  const status = err instanceof Error ? extractHttpStatus(err.message) : null
  const text = `tracking push failed (${kind}${status !== null ? `, status ${status}` : ""})`
  if (err instanceof DeferSyncError) return err
  const permanent =
    err instanceof PermanentSyncError ||
    (status !== null && status >= 400 && status <= 499 && status !== 429)
  return permanent ? new PermanentSyncError(text) : new Error(text)
}

/**
 * Processes one `shipment.created` tracking job for one connection. Every live
 * connection receives every shipment; only the connection that owns the order
 * (per the order's account metadata) pushes, the rest settle as `skipped`.
 */
export const processTrackingJob = async (
  job: TrackingJobData,
  deps: TrackingProcessorDeps
): Promise<TrackingJobResult> => {
  const { pool, integrationAccountId, marketplace } = deps

  const claim = await claimTrackingSyncJob(
    pool,
    integrationAccountId,
    job.fulfillmentId,
    deps.staleProcessingMs ?? STALE_PROCESSING_MS
  )
  if (claim.kind === "already_succeeded") return { status: "skipped" }
  if (claim.kind === "in_progress") {
    throw new DeferSyncError(
      "tracking for this fulfillment is being processed by another attempt",
      claim.leaseExpiresAt + 1_000
    )
  }

  const fence = { attempts: claim.attempts }
  const settle = async (
    status: TrackingJobResult["status"]
  ): Promise<TrackingJobResult> => {
    const recorded = await markSyncJobSucceeded(pool, claim.syncJobId, undefined, fence)
    if (!recorded) {
      console.warn(`[tracking] ${marketplace}: outcome decided but the claim was lost`)
    }
    return { status }
  }

  try {
    const order = await deps.medusaClient.getOrderForTracking(job.orderId)
    const target = order ? resolveTrackingTarget(order.metadata) : null
    if (
      !order ||
      !target ||
      target.marketplace !== marketplace ||
      target.accountId !== integrationAccountId
    ) {
      return await settle("skipped")
    }

    const fulfillment = order.fulfillments.find((f) => f.id === job.fulfillmentId)
    if (!fulfillment || fulfillment.canceledAt || fulfillment.labels.length === 0) {
      return await settle("skipped")
    }

    const outcome = await deps.push({
      order,
      fulfillment,
      externalOrderId: target.externalOrderId,
      noNotification: job.noNotification,
    })
    return await settle(outcome)
  } catch (err) {
    const toThrow = sanitizeError(err)
    const recorded = await markSyncJobFailed(pool, claim.syncJobId, toThrow.message, fence)
    if (!recorded) {
      console.warn(`[tracking] ${marketplace}: attempt failed after losing its claim`)
    }
    throw toThrow
  }
}
