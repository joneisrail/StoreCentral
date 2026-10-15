import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { DeferSyncError } from "../queue/queues.js"
import {
  claimOrderSyncJob,
  importClaimedAmazonOrder,
  type ImportAmazonOrderResult,
} from "./import-order.js"
import type { NormalizedAmazonOrder } from "./types.js"

export type OrderSyncJobData = { amazonOrderId: string }

export type OrderSyncProcessorDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  /** Resolves Medusa's "Amazon" sales channel id, or `null` if it doesn't exist. */
  resolveSalesChannelId: () => Promise<string | null>
  /** Fetches and normalizes the order from SP-API (`getOrder` in real wiring). */
  fetchOrder: (amazonOrderId: string) => Promise<NormalizedAmazonOrder>
  /** Defaults to `import-order.ts`'s `STALE_PROCESSING_MS`; overridable for tests. */
  staleProcessingMs?: number
}

/**
 * Processes one `order-sync` BullMQ job (enqueued by the SQS consumer for
 * each ORDER_CHANGE notification).
 *
 * Claims the order's `seller_hub.sync_job` row *first* -- before resolving
 * the Amazon sales channel or calling SP-API's `getOrder` -- so a failure in
 * either of those is recorded on that row (`failed`, with `last_error`) like
 * every other failure in this codebase, instead of surviving only in
 * BullMQ's own failed-job set once retries are exhausted. A side benefit:
 * a repeat ORDER_CHANGE for an already-imported order stops at the claim and
 * never spends SP-API's tightly rate-limited `getOrder` budget.
 *
 * Outcomes, as BullMQ sees them:
 * - already imported, or recovered/created now: resolves (job completed).
 * - permanent failure (unmapped SKU, 4xx): throws `PermanentSyncError`
 *   (no retry), row `failed`.
 * - transient failure (Medusa/SP-API 5xx, network error, timeout, missing
 *   sales channel): throws a plain `Error` (BullMQ retry/backoff), row
 *   `failed` -- the next attempt reclaims it.
 * - another attempt holds a live claim on this order: throws
 *   `DeferSyncError` to re-run this job once that claim would go stale,
 *   without consuming an attempt. Simply completing here would lose the
 *   import if that other holder was a process that has since been killed;
 *   a plain retry wouldn't help either, since the whole backoff schedule
 *   (~31s) is far shorter than the stale-claim threshold.
 */
export const processOrderSyncJob = async (
  data: OrderSyncJobData,
  deps: OrderSyncProcessorDeps
): Promise<ImportAmazonOrderResult> => {
  const { amazonOrderId } = data

  const claim = await claimOrderSyncJob(
    deps.pool,
    deps.integrationAccountId,
    amazonOrderId,
    deps.staleProcessingMs
  )

  if (claim.kind === "already_succeeded") {
    return { status: "skipped", medusaOrderId: claim.medusaOrderId }
  }
  if (claim.kind === "in_progress") {
    throw new DeferSyncError(
      `Amazon order ${amazonOrderId} is being imported by another attempt`,
      // A little past expiry, so the re-run finds the claim reclaimable.
      claim.leaseExpiresAt + 1_000
    )
  }

  return importClaimedAmazonOrder(
    amazonOrderId,
    claim,
    async () => {
      // Checked before `getOrder`, so a missing sales channel doesn't spend
      // SP-API budget on a request that can't succeed regardless.
      const salesChannelId = await deps.resolveSalesChannelId()
      if (!salesChannelId) {
        throw new Error(
          "Amazon sales channel not found in Medusa -- cannot import order"
        )
      }
      const order = await deps.fetchOrder(amazonOrderId)
      return { order, salesChannelId }
    },
    deps
  )
}
