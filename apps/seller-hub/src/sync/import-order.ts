import type { Pool } from "pg"
import type {
  CreateDraftOrderInput,
  DraftOrderLineItemInput,
  MedusaAdminClient,
} from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { NormalizedAmazonOrder } from "./types.js"

/**
 * How long a `processing` order `sync_job` row may go without its holder
 * touching `updated_at` before another caller may reclaim it. Covers a
 * holder that was killed mid-flight (e.g. `tsx watch` restarting the process
 * on a file save, with no graceful shutdown) and so never reached its own
 * success/failure UPDATE. The holder renews `updated_at` before every Medusa
 * mutation (see `renewLease`), so this only has to outlast a single Medusa
 * call, not a whole import.
 */
export const STALE_PROCESSING_MS = 5 * 60 * 1000

/**
 * Amazon `OrderStatus` values this import flow acts on directly (see the
 * check in `executeClaimedImport`). Every other status (`Unshipped`,
 * `PartiallyShipped`, `Shipped`, `InvoiceUnconfirmed`, `Unfulfillable`, or a
 * missing/unrecognized value) is treated as safe to import as-is.
 */
const CANCELED_ORDER_STATUS = "Canceled"
const PENDING_ORDER_STATUS = "Pending"

export type ImportAmazonOrderDeps = {
  pool: Pool
  integrationAccountId: string
  salesChannelId: string
  medusaClient: MedusaAdminClient
  /** Defaults to `STALE_PROCESSING_MS`; overridable for tests. */
  staleProcessingMs?: number
}

/**
 * - `created`: this call created (or finished converting) the Medusa order.
 * - `recovered`: this call reclaimed a `failed`/stale row and found that a
 *   previous attempt had in fact already produced the real Medusa order, so
 *   it just recorded that order as the job's outcome instead of creating a
 *   second one.
 * - `skipped`: nothing to do -- already succeeded, another caller holds a
 *   live claim on this order right now, or this caller lost its claim
 *   mid-flight to a stale-row reclaim.
 *
 * Failures are not a result: they throw (after being recorded on the
 * `sync_job` row) -- `PermanentSyncError` for failures that will repeat
 * identically on retry (unmapped SKU, a 4xx from Medusa), a plain `Error`
 * for transient ones (5xx, network error, timeout), so BullMQ's
 * retry/backoff applies to exactly the latter. Same classification
 * convention as `push-inventory.ts`/`push-price.ts`/`push-product.ts`.
 */
export type ImportAmazonOrderResult = {
  status: "created" | "recovered" | "skipped"
  medusaOrderId?: string
  reason?: string
}

/**
 * The outcome of trying to claim the `(integrationAccountId, 'order',
 * amazonOrderId)` `sync_job` row.
 *
 * - `claimed`: this caller now holds the row (`status = 'processing'`).
 *   `attempts` is the fencing token for every later write (see
 *   `SyncJobFence`); `draftOrderId` is a Medusa draft order a previous
 *   attempt already created for this Amazon order, if any.
 * - `already_succeeded`: a previous attempt finished.
 * - `in_progress`: another caller holds a live (non-stale) claim; it can be
 *   reclaimed at `leaseExpiresAt` (epoch ms) if that caller never finishes.
 */
export type OrderSyncClaim =
  | {
      kind: "claimed"
      syncJobId: string
      attempts: number
      draftOrderId: string | null
    }
  | { kind: "already_succeeded"; medusaOrderId?: string }
  | { kind: "in_progress"; leaseExpiresAt: number }

type ClaimedRow = {
  id: string
  attempts: number
  medusa_entity_id: string | null
}

/**
 * Claims the order `sync_job` row for `amazonOrderId`, creating it if this
 * is the first attempt. Called by the order-sync worker *before* it resolves
 * the sales channel or fetches the order from SP-API, so every failure from
 * that point on has a row to be recorded against (see
 * `sync/order-sync-processor.ts`).
 *
 * Every claim path is a single atomic statement, so concurrent callers
 * can't both win:
 *
 * 1. First attempt: `INSERT ... ON CONFLICT DO NOTHING` against the table's
 *    `UNIQUE (integration_account_id, sync_type, external_id)` constraint.
 *    Only one concurrent inserter gets a row back. (This is deliberately
 *    *not* `push-*.ts`'s `ON CONFLICT DO UPDATE SET status = 'processing'`
 *    upsert: that unconditionally re-claims the row, which is fine for an
 *    idempotent listing push but would let a duplicate ORDER_CHANGE
 *    notification re-run order creation for an already-imported order.)
 * 2. Retry: `UPDATE ... SET status = 'processing', attempts = attempts + 1
 *    WHERE <row> AND (status IN ('failed', 'pending') OR (status =
 *    'processing' AND updated_at < now() - stale))`. Postgres re-evaluates
 *    that WHERE against the latest row version after waiting out a
 *    concurrent UPDATE's row lock, so of several concurrent reclaimers only
 *    the first sees a reclaimable row; the rest match zero rows.
 *
 * Reclaiming does *not* by itself mean no Medusa order exists yet -- a
 * previous attempt may have converted its draft before failing to record
 * that (network error after the convert landed server-side, a DB blip on
 * the success UPDATE, a process kill). `executeClaimedImport` checks Medusa
 * for that before creating anything.
 */
export const claimOrderSyncJob = async (
  pool: Pool,
  integrationAccountId: string,
  amazonOrderId: string,
  staleProcessingMs: number = STALE_PROCESSING_MS
): Promise<OrderSyncClaim> => {
  const inserted = await pool.query<ClaimedRow>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'order', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id) DO NOTHING
     RETURNING id, attempts, medusa_entity_id`,
    [integrationAccountId, amazonOrderId]
  )
  if (inserted.rows[0]) {
    return toClaimed(inserted.rows[0])
  }

  // A row already exists. The loop only repeats if the row changes state
  // between the reclaim UPDATE and the follow-up SELECT (e.g. its holder
  // marks it failed in that instant), in which case it's reclaimable again.
  for (let i = 0; i < 3; i++) {
    const reclaimed = await pool.query<ClaimedRow>(
      `UPDATE seller_hub.sync_job
       SET status = 'processing', attempts = attempts + 1, updated_at = now()
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2
         AND (
           status IN ('failed', 'pending')
           OR (status = 'processing'
               AND updated_at < now() - ($3::float8 * interval '1 millisecond'))
         )
       RETURNING id, attempts, medusa_entity_id`,
      [integrationAccountId, amazonOrderId, staleProcessingMs]
    )
    if (reclaimed.rows[0]) {
      return toClaimed(reclaimed.rows[0])
    }

    const current = await pool.query<{
      status: string
      medusa_entity_id: string | null
      lease_expires_at: number
    }>(
      `SELECT status, medusa_entity_id,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::float8 + $3::float8 AS lease_expires_at
       FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, amazonOrderId, staleProcessingMs]
    )
    const row = current.rows[0]
    if (row?.status === "succeeded") {
      return {
        kind: "already_succeeded",
        medusaOrderId: row.medusa_entity_id ?? undefined,
      }
    }
    if (row?.status === "processing") {
      return { kind: "in_progress", leaseExpiresAt: row.lease_expires_at }
    }
  }

  throw new Error(
    `Could not claim order sync_job for Amazon order ${amazonOrderId}: ` +
      `row kept changing state under contention`
  )
}

const toClaimed = (row: ClaimedRow): OrderSyncClaim => ({
  kind: "claimed",
  syncJobId: row.id,
  attempts: row.attempts,
  draftOrderId: row.medusa_entity_id,
})

/**
 * Thrown internally when this caller's claim on the `sync_job` row was
 * taken over by a stale-`processing` reclaim. The caller must stop
 * touching Medusa and must not record any outcome: the new holder owns the
 * row now.
 */
export class LeaseLostError extends Error {
  constructor(syncJobId: string) {
    super(`Lost claim on order sync_job ${syncJobId} to a newer attempt`)
    this.name = "LeaseLostError"
  }
}

/**
 * Everything that differs between marketplaces in the claimed-import flow.
 * The claim, lease renewal, existing-order / draft recovery, no-partial-order
 * SKU check, draft persistence, convert and failure recording are shared;
 * an adapter supplies only the marketplace-specific parts. The Amazon adapter
 * (`amazonImportAdapter`) reproduces the original behaviour exactly.
 */
export type OrderImportAdapter<TOrder> = {
  /** Used in log/error text, e.g. "Amazon order". */
  label: string
  /** Medusa order metadata key holding the marketplace order id. */
  metadataKey: string
  /**
   * Runs before any Medusa write once the order is loaded. Returns a reason
   * to settle the job as an intentional no-op (`skipped`), returns null to
   * proceed, or throws (a plain Error / DeferSyncError to retry later, a
   * PermanentSyncError to fail for good).
   */
  gate: (order: TOrder, externalOrderId: string) => string | null
  lineItems: (
    order: TOrder
  ) => { sku: string; quantity: number; unitPrice?: number }[]
  draftFields: (
    order: TOrder,
    externalOrderId: string
  ) => Pick<CreateDraftOrderInput, "email" | "shipping_address" | "metadata">
}

export const amazonImportAdapter: OrderImportAdapter<NormalizedAmazonOrder> = {
  label: "Amazon order",
  metadataKey: "amazon_order_id",
  gate: (order, amazonOrderId) => {
    // A Canceled order is never imported -- that's terminal, so this is
    // recorded `succeeded` (an intentional no-op, not a failure) rather than
    // `failed`, and settles the row for good: a later duplicate notification
    // for the same order will find it already `succeeded` and skip without
    // re-checking anything.
    if (order.orderStatus === CANCELED_ORDER_STATUS) {
      return `Amazon order ${amazonOrderId} is Canceled; not imported`
    }
    // A Pending order's payment hasn't cleared yet -- unlike Canceled, this
    // can still become importable later, so it must stay retryable rather
    // than being settled. Throwing a plain (non-Permanent) Error marks the
    // row `failed` and leaves it reclaimable: either BullMQ's own
    // retry/backoff, or the next real ORDER_CHANGE notification Amazon sends
    // once the order advances, will try again via the normal `failed`-row
    // reclaim path in `claimOrderSyncJob`.
    if (order.orderStatus === PENDING_ORDER_STATUS) {
      throw new Error(
        `Amazon order ${amazonOrderId} is still Pending (unpaid); will ` +
          `retry once Amazon reports it ready`
      )
    }
    return null
  },
  lineItems: (order) => order.items,
  draftFields: (order) => ({
    email: order.buyerEmail,
    shipping_address: order.shippingAddress,
    metadata: { amazon_order_id: order.amazonOrderId },
  }),
}

type ClaimedImportDeps = {
  pool: Pool
  integrationAccountId: string
  medusaClient: MedusaAdminClient
}

/**
 * Runs a claimed order import end to end and records its outcome on the
 * claimed `sync_job` row: `succeeded` on success, `failed` (with the error)
 * on any failure -- including failures inside `loadContext`, which is where
 * the order-sync worker resolves the Amazon sales channel and fetches the
 * order from SP-API. Failures are rethrown classified (see
 * `ImportAmazonOrderResult`).
 *
 * `loadContext` is only invoked when a new draft actually has to be built --
 * after Medusa has been checked for an existing order or reusable draft --
 * so a reclaim that turns out to be already done never spends SP-API's
 * `getOrder` budget.
 */
export const importClaimedAmazonOrder = (
  amazonOrderId: string,
  claim: Extract<OrderSyncClaim, { kind: "claimed" }>,
  loadContext: () => Promise<{
    order: NormalizedAmazonOrder
    salesChannelId: string
  }>,
  deps: ClaimedImportDeps
): Promise<ImportAmazonOrderResult> =>
  importClaimedOrder(
    amazonOrderId,
    claim,
    loadContext,
    deps,
    amazonImportAdapter
  )

/** Marketplace-agnostic form of `importClaimedAmazonOrder`. */
export const importClaimedOrder = async <TOrder>(
  amazonOrderId: string,
  claim: Extract<OrderSyncClaim, { kind: "claimed" }>,
  loadContext: () => Promise<{
    order: TOrder
    salesChannelId: string
  }>,
  deps: ClaimedImportDeps,
  adapter: OrderImportAdapter<TOrder>
): Promise<ImportAmazonOrderResult> => {
  try {
    return await executeClaimedImport(
      amazonOrderId,
      claim,
      loadContext,
      deps,
      adapter
    )
  } catch (err) {
    if (err instanceof LeaseLostError) {
      console.warn(`[import-order] ${err.message}; leaving it to that attempt`)
      return { status: "skipped", reason: err.message }
    }
    const toThrow = classifySyncError(err)
    const recorded = await markSyncJobFailed(
      deps.pool,
      claim.syncJobId,
      toThrow.message,
      { attempts: claim.attempts }
    )
    if (!recorded) {
      console.warn(
        `[import-order] attempt for Amazon order ${amazonOrderId} failed ` +
          `after losing its claim; not recording: ${toThrow.message}`
      )
    }
    throw toThrow
  }
}

const executeClaimedImport = async <TOrder>(
  amazonOrderId: string,
  claim: Extract<OrderSyncClaim, { kind: "claimed" }>,
  loadContext: () => Promise<{
    order: TOrder
    salesChannelId: string
  }>,
  deps: ClaimedImportDeps,
  adapter: OrderImportAdapter<TOrder>
): Promise<ImportAmazonOrderResult> => {
  const { pool, integrationAccountId, medusaClient } = deps
  const fence = { attempts: claim.attempts }

  const renewLease = async (): Promise<void> => {
    const { rowCount } = await pool.query(
      `UPDATE seller_hub.sync_job SET updated_at = now()
       WHERE id = $1 AND status = 'processing' AND attempts = $2`,
      [claim.syncJobId, claim.attempts]
    )
    if (!rowCount) {
      throw new LeaseLostError(claim.syncJobId)
    }
  }

  const recordSucceeded = async (
    medusaOrderId?: string
  ): Promise<void> => {
    const recorded = await markSyncJobSucceeded(
      pool,
      claim.syncJobId,
      medusaOrderId,
      fence
    )
    if (!recorded) {
      // The outcome (an order, or an intentional no-op) is already decided;
      // a newer attempt owns the row and will reach the same outcome via
      // the same checks this attempt just ran.
      console.warn(
        `[import-order] outcome for Amazon order ${amazonOrderId} ` +
          `(medusaOrderId=${medusaOrderId ?? "none"}) decided, but this ` +
          `attempt lost its claim before recording it`
      )
    }
  }

  // Step 1: has a previous attempt already produced the real Medusa order?
  // Always checked (spec data-flow step 3), and the thing that makes
  // reclaiming a `failed`/stale row safe: without it, a retry after a
  // convert that landed server-side but looked like a failure client-side
  // would create a second real order for the same Amazon order.
  const existingOrder = await medusaClient.findOrderByMetadata(
    adapter.metadataKey,
    amazonOrderId
  )
  if (existingOrder) {
    await recordSucceeded(existingOrder.id)
    return { status: "recovered", medusaOrderId: existingOrder.id }
  }

  // Step 1b (defense in depth): a previous attempt persisted the draft it
  // created. Look it up by id -- a draft's id *is* its eventual order's id
  // in Medusa v2 -- which also catches an already-converted order that
  // `findOrderByMetadata`'s bounded first page missed.
  let draftOrderId: string | null = null
  if (claim.draftOrderId) {
    const previous = await medusaClient.getOrderById(claim.draftOrderId)
    if (previous && !previous.isDraftOrder) {
      await recordSucceeded(previous.id)
      return { status: "recovered", medusaOrderId: previous.id }
    }
    if (previous?.isDraftOrder) {
      draftOrderId = previous.id
    }
  }

  if (!draftOrderId) {
    // Only needed to build a new draft -- a reused draft already carries
    // its items, address and sales channel.
    const { order, salesChannelId } = await loadContext()

    // Step 1c/1d: marketplace-specific gate (cancelled -> settled no-op,
    // unpaid -> retryable throw, wrong currency -> permanent throw).
    const skipReason = adapter.gate(order, amazonOrderId)
    if (skipReason !== null) {
      await recordSucceeded(undefined)
      return { status: "skipped", reason: skipReason }
    }

    // Step 2: resolve every line item's SKU to a Medusa variant via
    // channel_listing. Any unmapped SKU fails the whole order before any
    // Medusa write (no partial order) -- permanently, since retrying with
    // the same mapping can't succeed.
    const orderItems = adapter.lineItems(order)
    const skus = orderItems.map((item) => item.sku)
    const listings = await pool.query<{
      external_sku: string
      medusa_variant_id: string
    }>(
      `SELECT external_sku, medusa_variant_id
       FROM seller_hub.channel_listing
       WHERE integration_account_id = $1 AND external_sku = ANY($2::text[])`,
      [integrationAccountId, skus]
    )
    const variantIdBySku = new Map(
      listings.rows.map((row) => [row.external_sku, row.medusa_variant_id])
    )

    const missingSkus = skus.filter((sku) => !variantIdBySku.has(sku))
    if (missingSkus.length > 0) {
      throw new PermanentSyncError(
        `No channel_listing mapping found for sku(s): ${missingSkus.join(", ")}`
      )
    }

    const items: DraftOrderLineItemInput[] = orderItems.map((item) => ({
      variant_id: variantIdBySku.get(item.sku)!,
      quantity: item.quantity,
      // Preserves what the buyer actually paid on Amazon; omitted (falls
      // back to Medusa's own current variant price) when Amazon's response
      // didn't carry a per-item price.
      ...(item.unitPrice !== undefined ? { unit_price: item.unitPrice } : {}),
    }))

    // Step 3: create the draft, then persist its id on the row *before*
    // converting, so a retry after a failed/ambiguous convert converts this
    // same draft instead of creating a second one. Both writes are fenced:
    // if a stale reclaim took the row over while we were blocked, stop
    // here rather than racing the new holder.
    await renewLease()
    const draft = await medusaClient.createDraftOrder({
      sales_channel_id: salesChannelId,
      items,
      ...adapter.draftFields(order, amazonOrderId),
    })
    const { rowCount } = await pool.query(
      `UPDATE seller_hub.sync_job SET medusa_entity_id = $1, updated_at = now()
       WHERE id = $2 AND status = 'processing' AND attempts = $3`,
      [draft.id, claim.syncJobId, claim.attempts]
    )
    if (!rowCount) {
      throw new LeaseLostError(claim.syncJobId)
    }
    draftOrderId = draft.id
  }

  // Step 4: convert. If a concurrent holder ever ends up converting the same
  // persisted draft, Medusa's own convert workflow (a lock on the draft id
  // plus its "must still be a draft" validation) lets only one succeed.
  await renewLease()
  let realOrder: { id: string }
  try {
    realOrder = await medusaClient.convertDraftOrderToOrder(draftOrderId)
  } catch (convertErr) {
    // The convert may have landed even though this call failed (network
    // error/timeout after Medusa committed it), or a concurrent holder may
    // have converted this same draft first (Medusa then rejects ours as no
    // longer a draft). Either way the real order exists: record it instead
    // of marking the row failed. If this check itself fails, rethrow the
    // original error -- the retry's existence checks will settle it.
    const after = await medusaClient
      .getOrderById(draftOrderId)
      .catch(() => null)
    if (after && !after.isDraftOrder) {
      await recordSucceeded(after.id)
      return { status: "created", medusaOrderId: after.id }
    }
    throw convertErr
  }

  await recordSucceeded(realOrder.id)
  return { status: "created", medusaOrderId: realOrder.id }
}

/**
 * Imports a single normalized Amazon order into Medusa as a real order,
 * at most once per `(integrationAccountId, amazonOrderId)` pair.
 *
 * Claims the order's `sync_job` row (`claimOrderSyncJob`), then runs the
 * import (`importClaimedAmazonOrder`). A row another caller is actively
 * working (`processing`, not yet stale) or that already `succeeded` is
 * reported `skipped` without any Medusa call. A `failed` row, or a
 * `processing` row left stale by a killed process, is reclaimed and
 * retried -- but only after confirming Medusa has no order for it yet.
 *
 * Throws (after recording the failure on the row) instead of returning a
 * failure status; see `ImportAmazonOrderResult` for the classification.
 */
export const importAmazonOrder = async (
  order: NormalizedAmazonOrder,
  deps: ImportAmazonOrderDeps
): Promise<ImportAmazonOrderResult> => {
  const claim = await claimOrderSyncJob(
    deps.pool,
    deps.integrationAccountId,
    order.amazonOrderId,
    deps.staleProcessingMs
  )
  if (claim.kind === "already_succeeded") {
    return { status: "skipped", medusaOrderId: claim.medusaOrderId }
  }
  if (claim.kind === "in_progress") {
    return {
      status: "skipped",
      reason: "another attempt is currently importing this order",
    }
  }

  return importClaimedAmazonOrder(
    order.amazonOrderId,
    claim,
    async () => ({ order, salesChannelId: deps.salesChannelId }),
    deps
  )
}

// Same convention as `push-price.ts`'s `classifySyncError`/
// `extractHttpStatus` (duplicated per file on purpose, like the push-*.ts
// copies): a 4xx-class rejection other than 429 becomes `PermanentSyncError`
// (no retry); anything else -- 5xx, 429, network errors, timeouts -- is
// re-thrown unchanged so BullMQ's normal retry/backoff applies.
const classifySyncError = (err: unknown): Error => {
  if (err instanceof PermanentSyncError) {
    return err
  }
  if (err instanceof Error) {
    const status = extractHttpStatus(err.message)
    if (status !== null && status >= 400 && status <= 499 && status !== 429) {
      return new PermanentSyncError(err.message)
    }
    return err
  }
  return new Error(String(err))
}

const extractHttpStatus = (message: string): number | null => {
  const statusKeyword = message.match(/status\s+(\d{3})\b/i)
  if (statusKeyword) {
    return Number(statusKeyword[1])
  }
  const leadingCode = message.match(/^(\d{3}):/)
  if (leadingCode) {
    return Number(leadingCode[1])
  }
  return null
}
