import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { DeferSyncError } from "../queue/queues.js"
import type { NormalizedWooOrder } from "../woocommerce/orders.js"
import { claimOrderSyncJob, type ImportAmazonOrderResult } from "./import-order.js"
import { importClaimedWooOrder } from "./woocommerce-import-order.js"

/** `wooOrderId` is the numeric WooCommerce order id as a string. */
export type WooOrderSyncJobData = { wooOrderId: string }

export type WooOrderSyncProcessorDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  /** Resolves Medusa's "WordPress" sales channel id, or `null` if absent. */
  resolveSalesChannelId: () => Promise<string | null>
  fetchOrder: (wooOrderId: string) => Promise<NormalizedWooOrder>
  staleProcessingMs?: number
}

/**
 * Processes one `woocommerce-order-sync` job. Same shape and failure
 * semantics as the Shopify processor: claim the order's sync_job row first, so
 * a redelivered webhook (a NEW queue job, since finished jobs are removed) for
 * an already-imported order stops at the claim, and a live claim held by
 * another attempt defers this job instead of dropping it.
 */
export const processWooOrderSyncJob = async (
  data: WooOrderSyncJobData,
  deps: WooOrderSyncProcessorDeps
): Promise<ImportAmazonOrderResult> => {
  const { wooOrderId } = data

  const claim = await claimOrderSyncJob(
    deps.pool,
    deps.integrationAccountId,
    wooOrderId,
    deps.staleProcessingMs
  )
  if (claim.kind === "already_succeeded") {
    return { status: "skipped", medusaOrderId: claim.medusaOrderId }
  }
  if (claim.kind === "in_progress") {
    throw new DeferSyncError(
      `WooCommerce order ${wooOrderId} is being imported by another attempt`,
      claim.leaseExpiresAt + 1_000
    )
  }

  return importClaimedWooOrder(
    wooOrderId,
    claim,
    async () => {
      const salesChannelId = await deps.resolveSalesChannelId()
      if (!salesChannelId) {
        throw new Error(
          "WordPress sales channel not found in Medusa -- cannot import order"
        )
      }
      const order = await deps.fetchOrder(wooOrderId)
      return { order, salesChannelId }
    },
    deps
  )
}
