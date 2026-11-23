import type { Pool } from "pg"
import {
  DraftProductStockError,
  sanitizeSyncError,
  type MedusaAdminClient,
} from "../medusa/admin-client.js"
import {
  IMPORT_RUN_CAP,
  planImport,
  type ChannelListing,
  type ImportPlan,
} from "./channel-import.js"

export type ImportPreview = ImportPlan

export type ImportOutcome = {
  imported: string[]
  failed: { sku: string; message: string }[]
  skipped: { sku: string; reason: "already_linked" | "currency" }[]
  deferred: string[]
}

type ReadDeps = {
  /** Read-only: returns the channel catalogue. Never writes to the channel. */
  channel: () => Promise<ChannelListing[]>
  medusaClient: MedusaAdminClient
}

const skuOf = (listing: ChannelListing): string => (listing.sku ?? "").trim()

const titleOf = (listing: ChannelListing): string => {
  const { title, parentTitle } = listing
  if (title && parentTitle && parentTitle !== title) return `${parentTitle} - ${title}`
  return title || parentTitle || skuOf(listing)
}

const readPlan = async ({ channel, medusaClient }: ReadDeps): Promise<ImportPlan> => {
  const [listings, store] = await Promise.all([channel(), medusaClient.listVariantsBySku()])
  return planImport(listings, store)
}

/** Groups the channel catalogue against the store. Writes nothing anywhere. */
export const previewImport = (deps: ReadDeps): Promise<ImportPreview> => readPlan(deps)

const recordProblem = async (
  pool: Pool,
  integrationAccountId: string,
  sku: string,
  message: string
): Promise<void> => {
  await pool.query(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, last_error)
     VALUES ($1, 'product', $2, 'failed', $3)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'failed', last_error = EXCLUDED.last_error, updated_at = now()`,
    [integrationAccountId, sku, message]
  )
}

const recordSuccess = async (
  pool: Pool,
  integrationAccountId: string,
  sku: string,
  productId: string
): Promise<void> => {
  await pool.query(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, medusa_entity_id)
     VALUES ($1, 'product', $2, 'succeeded', $3)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'succeeded', last_error = NULL,
       medusa_entity_id = EXCLUDED.medusa_entity_id, updated_at = now()`,
    [integrationAccountId, sku, productId]
  )
}

const parsePrice = (raw: string): number => {
  const trimmed = raw.trim()
  if (trimmed === "") throw new Error("channel listing has no price")
  const price = Number(trimmed)
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("channel listing has an invalid price")
  }
  return price
}

/**
 * Creates one draft StoreCentral product per selected unmatched channel
 * listing and links it in `seller_hub.channel_listing`. Re-reads the channel
 * and the store itself; the caller's SKU list only selects from the plan.
 * At most `IMPORT_RUN_CAP` listings are created per run, the rest come back
 * in `deferred`. Never writes to the channel.
 *
 * `inventoryItemIdOf` supplies `external_inventory_item_id` (the column
 * `shopify-link.ts` sets); without it the column is left null.
 */
export const runImport = async (deps: {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  channel: () => Promise<ChannelListing[]>
  skus: string[] | "all"
  inventoryItemIdOf?: (listing: ChannelListing) => string | null
}): Promise<ImportOutcome> => {
  const { pool, medusaClient, integrationAccountId, skus, inventoryItemIdOf } = deps
  const plan = await readPlan(deps)

  const wanted = skus === "all" ? null : new Set(skus.map((s) => s.trim()))
  const isWanted = (l: ChannelListing) => wanted === null || wanted.has(skuOf(l))
  const selected = plan.unmatched.filter(isWanted)
  // Explicitly named SKUs that are already matched are reported if linked.
  const namedMatched = wanted === null ? [] : plan.matched.filter(isWanted)

  const candidateSkus = [...selected, ...namedMatched].map(skuOf)
  const linked = new Set<string>()
  if (candidateSkus.length > 0) {
    const { rows } = await pool.query<{ external_sku: string }>(
      `SELECT external_sku FROM seller_hub.channel_listing
       WHERE integration_account_id = $1 AND external_sku = ANY($2::text[])`,
      [integrationAccountId, candidateSkus]
    )
    for (const r of rows) linked.add(r.external_sku)
  }

  const outcome: ImportOutcome = { imported: [], failed: [], skipped: [], deferred: [] }
  const defaultCurrency = (await medusaClient.getDefaultCurrency()).toLowerCase()

  // Skips are decided before the cap so permanently skipped listings never
  // hold back the importable ones on later runs.
  const importable: ChannelListing[] = []
  const channelOrder = new Map<string, number>()
  const all = [...selected, ...namedMatched]
  all.forEach((l, i) => channelOrder.set(skuOf(l), i))
  for (const listing of selected) {
    const sku = skuOf(listing)
    if (linked.has(sku)) {
      outcome.skipped.push({ sku, reason: "already_linked" })
    } else if (listing.currency !== null && listing.currency.toLowerCase() !== defaultCurrency) {
      outcome.skipped.push({ sku, reason: "currency" })
    } else {
      importable.push(listing)
    }
  }
  for (const listing of namedMatched) {
    const sku = skuOf(listing)
    if (linked.has(sku)) outcome.skipped.push({ sku, reason: "already_linked" })
  }
  outcome.skipped.sort((a, b) => channelOrder.get(a.sku)! - channelOrder.get(b.sku)!)

  const batch = importable.slice(0, IMPORT_RUN_CAP)
  outcome.deferred = importable.slice(IMPORT_RUN_CAP).map(skuOf)

  const insertLink = async (
    listing: ChannelListing,
    ids: { productId: string; variantId: string }
  ): Promise<boolean> => {
    const res = await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku,
          external_variant_id, external_parent_id, external_inventory_item_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'published')
       ON CONFLICT (integration_account_id, external_sku) DO NOTHING`,
      [
        integrationAccountId,
        ids.productId,
        ids.variantId,
        skuOf(listing),
        listing.externalId,
        listing.parentExternalId,
        inventoryItemIdOf ? inventoryItemIdOf(listing) : null,
      ]
    )
    return res.rowCount === 1
  }

  // Returns null on success, else the (unsanitized) failure message.
  const importOne = async (listing: ChannelListing, sku: string): Promise<string | null> => {
    try {
      const price = parsePrice(listing.price)
      let ids: { productId: string; variantId: string }
      let stockError: string | null = null
      try {
        ids = await medusaClient.createDraftProduct({
          title: titleOf(listing),
          sku,
          price,
          currencyCode: defaultCurrency,
          imageUrl: listing.imageUrl,
          initialStock: listing.stock,
        })
      } catch (error) {
        if (!(error instanceof DraftProductStockError)) throw error
        // The draft exists: link it so a retry never creates a second one.
        ids = { productId: error.productId, variantId: error.variantId }
        stockError = error.message
      }
      if (!(await insertLink(listing, ids))) {
        return `draft product ${ids.productId} created but the SKU was already linked`
      }
      if (stockError !== null) return `draft created but initial stock failed: ${stockError}`
      await recordSuccess(pool, integrationAccountId, sku, ids.productId)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  for (const listing of batch) {
    const sku = skuOf(listing)
    const problem = await importOne(listing, sku)
    if (problem === null) {
      outcome.imported.push(sku)
    } else {
      const message = sanitizeSyncError(problem)
      outcome.failed.push({ sku, message })
      await recordProblem(pool, integrationAccountId, sku, message)
    }
  }

  return outcome
}
