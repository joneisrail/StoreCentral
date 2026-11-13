import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { DeferSyncError } from "../queue/queues.js"
import type { NormalizedShopifyOrder } from "../shopify/orders.js"
import { claimOrderSyncJob, type ImportAmazonOrderResult } from "./import-order.js"
import { importClaimedShopifyOrder } from "./shopify-import-order.js"

/** `shopifyOrderId` is the GraphQL id, `gid://shopify/Order/<n>`. */
export type ShopifyOrderSyncJobData = { shopifyOrderId: string }

export type ShopifyOrderSyncProcessorDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  /** Resolves Medusa's "Shopify" sales channel id, or `null` if absent. */
  resolveSalesChannelId: () => Promise<string | null>
  fetchOrder: (shopifyOrderId: string) => Promise<NormalizedShopifyOrder>
  staleProcessingMs?: number
}

/**
 * Processes one `shopify-order-sync` job. Same shape and failure semantics as
 * `processOrderSyncJob` (Amazon): claim the order's sync_job row first, so a
 * redelivered webhook (a NEW queue job, since finished jobs are removed) for
 * an already-imported order stops at the claim, and a live claim held by
 * another attempt defers this job instead of dropping it.
 */
export const processShopifyOrderSyncJob = async (
  data: ShopifyOrderSyncJobData,
  deps: ShopifyOrderSyncProcessorDeps
): Promise<ImportAmazonOrderResult> => {
  const { shopifyOrderId } = data

  const claim = await claimOrderSyncJob(
    deps.pool,
    deps.integrationAccountId,
    shopifyOrderId,
    deps.staleProcessingMs
  )
  if (claim.kind === "already_succeeded") {
    return { status: "skipped", medusaOrderId: claim.medusaOrderId }
  }
  if (claim.kind === "in_progress") {
    throw new DeferSyncError(
      `Shopify order ${shopifyOrderId} is being imported by another attempt`,
      claim.leaseExpiresAt + 1_000
    )
  }

  return importClaimedShopifyOrder(
    shopifyOrderId,
    claim,
    async () => {
      const salesChannelId = await deps.resolveSalesChannelId()
      if (!salesChannelId) {
        throw new Error(
          "Shopify sales channel not found in Medusa -- cannot import order"
        )
      }
      const order = await deps.fetchOrder(shopifyOrderId)
      return { order, salesChannelId }
    },
    deps
  )
}
