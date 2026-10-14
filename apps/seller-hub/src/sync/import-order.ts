import type { Pool } from "pg"
import type {
  DraftOrderLineItemInput,
  MedusaAdminClient,
} from "../medusa/admin-client.js"
import type { NormalizedAmazonOrder } from "./types.js"

export type ImportAmazonOrderDeps = {
  pool: Pool
  integrationAccountId: string
  salesChannelId: string
  medusaClient: MedusaAdminClient
}

export type ImportAmazonOrderResult = {
  status: "created" | "skipped" | "needs_attention"
  medusaOrderId?: string
  reason?: string
}

type SyncJobRow = {
  id: string
  status: string
  medusa_entity_id: string | null
}

/**
 * Imports a single normalized Amazon order into Medusa as a real order,
 * exactly once per `(integrationAccountId, amazonOrderId)` pair — unless a
 * prior attempt `failed`, in which case a later call retries it.
 *
 * Idempotency is enforced by the DB, not by application logic: the
 * `seller_hub.sync_job` table has a
 * `UNIQUE (integration_account_id, sync_type, external_id)` constraint
 * (see `apps/seller-hub/src/db/schema.ts`), and this function's insert
 * relies on `ON CONFLICT ... DO NOTHING` against that constraint rather
 * than a SELECT-then-INSERT check. That means two concurrent/duplicate
 * calls for the same Amazon order can race on the initial SELECT, but
 * only one of them can win the INSERT — the loser never reaches the
 * Medusa API calls below, so at most one real Medusa order is ever
 * created per Amazon order.
 *
 * Retrying a `failed` job (e.g. after a transient Medusa error, or after
 * fixing a missing `channel_listing` mapping) uses the same pattern one
 * level down: claiming the existing row via
 * `UPDATE ... SET status = 'processing' WHERE id = $1 AND status = 'failed'`.
 * That `WHERE status = 'failed'` guard is what makes the claim atomic —
 * Postgres' row lock means only one of several concurrent retries can
 * flip the row from `failed` to `processing`; every other concurrent
 * claimer's `UPDATE` then sees a row that's no longer `failed` and affects
 * zero rows, so it backs off instead of also proceeding. This matters
 * because Task 7's BullMQ retry/backoff re-invokes this exact function
 * with the same Amazon order id on a transient failure — without this,
 * a retry would silently report "skipped" forever instead of actually
 * retrying.
 */
export const importAmazonOrder = async (
  order: NormalizedAmazonOrder,
  deps: ImportAmazonOrderDeps
): Promise<ImportAmazonOrderResult> => {
  const { pool, integrationAccountId, salesChannelId, medusaClient } = deps

  // Step 1: a prior successful import already exists — nothing to do.
  const existing = await pool.query<SyncJobRow>(
    `SELECT id, status, medusa_entity_id
     FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, order.amazonOrderId]
  )
  const existingRow = existing.rows[0]
  if (existingRow?.status === "succeeded") {
    return {
      status: "skipped",
      medusaOrderId: existingRow.medusa_entity_id ?? undefined,
    }
  }

  // Step 2: claim the job by inserting a 'processing' row. The UNIQUE
  // constraint — not this check — is what actually prevents two concurrent
  // callers from both proceeding: if another caller's insert won the race
  // (or a prior attempt already left a row behind), this INSERT conflicts
  // and inserts nothing, and we fall back to the "already exists" path
  // instead of erroring.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'order', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id) DO NOTHING
     RETURNING id`,
    [integrationAccountId, order.amazonOrderId]
  )

  let syncJobId: string
  if (inserted.rows.length === 0) {
    // Lost the insert (or a row already existed from a previous run).
    const conflictRow = await pool.query<SyncJobRow>(
      `SELECT id, status, medusa_entity_id
       FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, order.amazonOrderId]
    )
    const row = conflictRow.rows[0]

    if (!row) {
      // Vanishingly unlikely (row deleted between the failed insert and
      // this select) — nothing to retry, nothing to report as created.
      return { status: "skipped" }
    }

    if (row.status === "succeeded") {
      return {
        status: "skipped",
        medusaOrderId: row.medusa_entity_id ?? undefined,
      }
    }

    if (row.status !== "failed") {
      // status === 'processing': another caller is actively working this
      // job right now. Defer to it rather than making our own Medusa
      // call — this is the guarantee that matters: this caller makes zero
      // Medusa calls once it knows it didn't win the claim.
      return {
        status: "skipped",
        medusaOrderId: row.medusa_entity_id ?? undefined,
      }
    }

    // row.status === 'failed': a prior attempt gave up (transient Medusa
    // error, unmapped SKU since fixed, etc). Atomically claim it for a
    // retry — see the function-level doc comment for why the
    // `WHERE status = 'failed'` guard is what keeps this race-free.
    const claimed = await pool.query<{ id: string }>(
      `UPDATE seller_hub.sync_job
       SET status = 'processing', attempts = attempts + 1, updated_at = now()
       WHERE id = $1 AND status = 'failed'
       RETURNING id`,
      [row.id]
    )

    if (claimed.rows.length === 0) {
      // Lost the claim race to another concurrent retry.
      return {
        status: "skipped",
        medusaOrderId: row.medusa_entity_id ?? undefined,
      }
    }

    syncJobId = claimed.rows[0]!.id
  } else {
    syncJobId = inserted.rows[0]!.id
  }

  // Step 3: resolve every line item's SKU to a Medusa variant via
  // channel_listing. Any unmapped SKU fails the whole order before any
  // Medusa call is made (no partial order).
  const skus = order.items.map((item) => item.sku)
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
    const reason = `No channel_listing mapping found for sku(s): ${missingSkus.join(", ")}`
    await pool.query(
      `UPDATE seller_hub.sync_job
       SET status = 'failed', last_error = $1, updated_at = now()
       WHERE id = $2`,
      [reason, syncJobId]
    )
    return { status: "needs_attention", reason }
  }

  // Step 4: map to Medusa's draft-order line item shape.
  const items: DraftOrderLineItemInput[] = order.items.map((item) => ({
    variant_id: variantIdBySku.get(item.sku)!,
    quantity: item.quantity,
  }))

  // Step 5 + 6: create the real Medusa order and record the outcome. A
  // failure here marks the job 'failed' with the error recorded instead of
  // throwing, so the caller always gets one of the three documented
  // outcomes rather than an unhandled rejection.
  try {
    const draft = await medusaClient.createDraftOrder({
      sales_channel_id: salesChannelId,
      email: order.buyerEmail,
      items,
      shipping_address: order.shippingAddress,
      metadata: { amazon_order_id: order.amazonOrderId },
    })
    const realOrder = await medusaClient.convertDraftOrderToOrder(draft.id)

    await pool.query(
      `UPDATE seller_hub.sync_job
       SET status = 'succeeded', medusa_entity_id = $1, last_error = NULL, updated_at = now()
       WHERE id = $2`,
      [realOrder.id, syncJobId]
    )

    return { status: "created", medusaOrderId: realOrder.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await pool.query(
      `UPDATE seller_hub.sync_job
       SET status = 'failed', last_error = $1, updated_at = now()
       WHERE id = $2`,
      [message, syncJobId]
    )
    return { status: "needs_attention", reason: message }
  }
}
