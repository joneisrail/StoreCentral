import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { WooCommerceClient } from "../woocommerce/client.js"
import { listWooListings } from "../woocommerce/products.js"
import type { LinkResult } from "./shopify-link.js"

export type { LinkResult }

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

/**
 * Links WooCommerce simple products and variations to StoreCentral variants by
 * exact (case-sensitive, trimmed) SKU. Unmatched and duplicate SKUs are never
 * linked; they are returned and recorded on seller_hub.sync_job.
 */
export const linkWooCommerceListings = async (deps: {
  pool: Pool
  medusaClient: MedusaAdminClient
  wooClient: WooCommerceClient
  integrationAccountId: string
}): Promise<LinkResult> => {
  const { pool, medusaClient, wooClient, integrationAccountId } = deps
  const [wooAll, medusaAll] = await Promise.all([
    listWooListings(wooClient),
    medusaClient.listVariantsBySku(),
  ])

  const group = <T>(items: T[], skuOf: (t: T) => string | null | undefined) => {
    const map = new Map<string, T[]>()
    for (const item of items) {
      const sku = skuOf(item)?.trim()
      if (!sku) continue
      map.set(sku, [...(map.get(sku) ?? []), item])
    }
    return map
  }
  const woo = group(wooAll, (l) => l.sku)
  const medusa = group(medusaAll, (v) => v.sku)

  const result: LinkResult = { linked: 0, alreadyLinked: 0, unmatched: [], duplicates: [] }

  for (const [sku, wListings] of woo) {
    const mVariants = medusa.get(sku) ?? []
    if (wListings.length > 1 || mVariants.length > 1) {
      result.duplicates.push(sku)
      await recordProblem(
        pool,
        integrationAccountId,
        sku,
        `Duplicate SKU: ${wListings.length} WooCommerce listing(s), ${mVariants.length} StoreCentral variant(s); not linked`
      )
      continue
    }
    const m = mVariants[0]
    if (!m) {
      result.unmatched.push(sku)
      await recordProblem(
        pool,
        integrationAccountId,
        sku,
        "No StoreCentral variant has this SKU; not linked"
      )
      continue
    }
    const w = wListings[0]!
    const res = await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku,
          external_variant_id, external_parent_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'published')
       ON CONFLICT (integration_account_id, external_sku) DO NOTHING`,
      [
        integrationAccountId,
        m.productId,
        m.variantId,
        sku,
        String(w.id),
        w.parentId === null ? null : String(w.parentId),
      ]
    )
    if (res.rowCount === 1) result.linked++
    else result.alreadyLinked++
  }
  return result
}
