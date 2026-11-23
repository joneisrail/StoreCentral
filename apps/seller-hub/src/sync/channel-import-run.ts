import type { Pool } from "pg"
import {
  DraftProductStockError,
  sanitizeSyncError,
  type MedusaAdminClient,
} from "../medusa/admin-client.js"
import {
  IMPORT_RUN_CAP,
  planImport,
  titleOf,
  type ChannelListing,
  type ImportPlan,
} from "./channel-import.js"
import { applyPriceRule } from "./push-price.js"

export type ImportPreview = ImportPlan

export type ImportOutcome = {
  imported: string[]
  failed: { sku: string; message: string }[]
  skipped: { sku: string; reason: "already_linked" | "matched" | "currency" }[]
  deferred: string[]
}

type ReadDeps = {
  /** Read-only: returns the channel catalogue. Never writes to the channel. */
  channel: () => Promise<ChannelListing[]>
  medusaClient: MedusaAdminClient
}

const skuOf = (listing: ChannelListing): string => (listing.sku ?? "").trim()

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
     DO UPDATE SET status = 'failed', last_error = EXCLUDED.last_error, updated_at = now()
     WHERE seller_hub.sync_job.status <> 'succeeded'`,
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
 * Selected listings that are already linked, match an existing store variant,
 * or carry another currency are skipped; listings without a usable price are
 * recorded as failed. Only then is the cap applied: at most `IMPORT_RUN_CAP`
 * products are created per run, the rest come back in `deferred`. Never
 * writes to the channel.
 */
export const runImport = async (deps: {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  channel: () => Promise<ChannelListing[]>
  skus: string[] | "all"
}): Promise<ImportOutcome> => {
  const { pool, medusaClient, integrationAccountId, skus, channel } = deps
  const [listings, store] = await Promise.all([channel(), medusaClient.listVariantsBySku()])
  const plan = planImport(listings, store)
  const position = new Map(listings.map((l, i) => [l, i] as const))
  const byChannelOrder = (a: ChannelListing, b: ChannelListing) =>
    position.get(a)! - position.get(b)!

  const wanted = skus === "all" ? null : new Set(skus.map((s) => s.trim()))
  const isWanted = (l: ChannelListing) => wanted === null || wanted.has(skuOf(l))
  const unmatched = new Set(plan.unmatched)
  // Selected SKUs in no planner group (duplicates, no SKU, not on the channel) stay unreported.
  const selected = [...plan.unmatched, ...plan.matched].filter(isWanted).sort(byChannelOrder)

  const linked = new Set<string>()
  if (selected.length > 0) {
    const { rows } = await pool.query<{ external_sku: string }>(
      `SELECT external_sku FROM seller_hub.channel_listing
       WHERE integration_account_id = $1 AND external_sku = ANY($2::text[])`,
      [integrationAccountId, selected.map(skuOf)]
    )
    for (const r of rows) linked.add(r.external_sku)
  }

  const outcome: ImportOutcome = { imported: [], failed: [], skipped: [], deferred: [] }
  const defaultCurrency = (await medusaClient.getDefaultCurrency()).toLowerCase()

  const fail = async (sku: string, problem: string) => {
    const message = sanitizeSyncError(problem)
    outcome.failed.push({ sku, message })
    await recordProblem(pool, integrationAccountId, sku, message)
  }

  // Skips and price failures are settled before the cap so listings that can
  // never be imported do not hold back importable ones on later runs.
  const importable: { listing: ChannelListing; price: number }[] = []
  for (const listing of selected) {
    const sku = skuOf(listing)
    if (linked.has(sku)) {
      outcome.skipped.push({ sku, reason: "already_linked" })
    } else if (!unmatched.has(listing)) {
      outcome.skipped.push({ sku, reason: "matched" })
    } else if (listing.currency !== null && listing.currency.toLowerCase() !== defaultCurrency) {
      outcome.skipped.push({ sku, reason: "currency" })
    } else {
      let price: number
      try {
        price = parsePrice(listing.price)
      } catch (error) {
        await fail(sku, (error as Error).message)
        continue
      }
      importable.push({ listing, price })
    }
  }

  const batch = importable.slice(0, IMPORT_RUN_CAP)
  outcome.deferred = importable.slice(IMPORT_RUN_CAP).map((i) => skuOf(i.listing))

  // The baseline is what Medusa now holds (the stock actually set, the price
  // as the reconcilers compare it: post-rule, and a new link has no rule), so
  // the first reconcile sees no drift and never pushes StoreCentral values over
  // the channel's.
  const insertLink = async (
    listing: ChannelListing,
    ids: { productId: string; variantId: string },
    baseline: { quantity: number; price: number }
  ): Promise<boolean> => {
    const res = await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku,
          external_variant_id, external_parent_id, external_inventory_item_id, status,
          last_synced_quantity, last_synced_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8, $9)
       ON CONFLICT (integration_account_id, external_sku) DO NOTHING`,
      [
        integrationAccountId,
        ids.productId,
        ids.variantId,
        skuOf(listing),
        listing.externalId,
        listing.parentExternalId,
        listing.inventoryItemId ?? null,
        baseline.quantity,
        applyPriceRule(baseline.price, null),
      ]
    )
    return res.rowCount === 1
  }

  // Returns null on success, else the (unsanitized) failure message.
  const importOne = async (
    listing: ChannelListing,
    sku: string,
    price: number
  ): Promise<string | null> => {
    try {
      // Same clamp as the reconcilers apply to Medusa's quantity.
      const initialStock =
        listing.stock === null || !Number.isFinite(listing.stock)
          ? null
          : Math.max(0, Math.floor(listing.stock))
      let ids: { productId: string; variantId: string }
      let stockError: string | null = null
      try {
        ids = await medusaClient.createDraftProduct({
          title: titleOf(listing),
          sku,
          price,
          currencyCode: defaultCurrency,
          imageUrl: listing.imageUrl,
          initialStock,
        })
      } catch (error) {
        if (!(error instanceof DraftProductStockError)) throw error
        // The draft exists: link it so a retry never creates a second one.
        ids = { productId: error.productId, variantId: error.variantId }
        stockError = error.message
      }
      // No stock set (null stock, or the stock step failed): Medusa holds 0.
      const quantity = stockError === null ? (initialStock ?? 0) : 0
      if (!(await insertLink(listing, ids, { quantity, price }))) {
        return `draft product ${ids.productId} created but the SKU was already linked`
      }
      if (stockError !== null) return `draft created but initial stock failed: ${stockError}`
      await recordSuccess(pool, integrationAccountId, sku, ids.productId)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  for (const { listing, price } of batch) {
    const sku = skuOf(listing)
    const problem = await importOne(listing, sku, price)
    if (problem === null) outcome.imported.push(sku)
    else await fail(sku, problem)
  }

  return outcome
}
