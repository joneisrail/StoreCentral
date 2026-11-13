import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { ShopifyClient } from "../shopify/client.js"
import { listShopifyVariants } from "../shopify/products.js"

export type LinkResult = {
  linked: number
  alreadyLinked: number
  unmatched: string[]
  duplicates: string[]
}

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
 * Links Shopify variants to StoreCentral variants by exact (case-sensitive,
 * trimmed) SKU. Unmatched and duplicate SKUs are never linked; they are
 * returned and recorded on seller_hub.sync_job.
 */
export const linkShopifyVariants = async (deps: {
  pool: Pool
  medusaClient: MedusaAdminClient
  shopifyClient: ShopifyClient
  integrationAccountId: string
}): Promise<LinkResult> => {
  const { pool, medusaClient, shopifyClient, integrationAccountId } = deps
  const [shopifyAll, medusaAll] = await Promise.all([
    listShopifyVariants(shopifyClient),
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
  const shopify = group(shopifyAll, (v) => v.sku)
  const medusa = group(medusaAll, (v) => v.sku)

  const result: LinkResult = { linked: 0, alreadyLinked: 0, unmatched: [], duplicates: [] }

  for (const [sku, sVariants] of shopify) {
    const mVariants = medusa.get(sku) ?? []
    if (sVariants.length > 1 || mVariants.length > 1) {
      result.duplicates.push(sku)
      await recordProblem(
        pool,
        integrationAccountId,
        sku,
        `Duplicate SKU: ${sVariants.length} Shopify variant(s), ${mVariants.length} StoreCentral variant(s); not linked`
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
    const s = sVariants[0]!
    const res = await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku,
          external_variant_id, external_inventory_item_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'published')
       ON CONFLICT (integration_account_id, external_sku) DO NOTHING`,
      [integrationAccountId, m.productId, m.variantId, sku, s.variantId, s.inventoryItemId]
    )
    if (res.rowCount === 1) result.linked++
    else result.alreadyLinked++
  }
  return result
}
