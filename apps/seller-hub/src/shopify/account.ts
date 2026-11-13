import type { Pool } from "pg"
import { encrypt } from "../crypto/secret-box.js"
import type { ShopifyConfig } from "./config.js"

type AccountRow = { id: string; shop_domain: string; shopify_location_id: string }

const toResult = (row: AccountRow) => ({
  id: row.id,
  shopDomain: row.shop_domain,
  locationId: row.shopify_location_id,
})

/**
 * Finds or creates the single unmanaged (env-start) Shopify integration_account row and refreshes
 * its shop domain, location and (encrypted) access token. Idempotent.
 */
export const resolveShopifyAccount = async (
  pool: Pool,
  config: ShopifyConfig,
  encryptionKey: string
): Promise<{ id: string; shopDomain: string; locationId: string }> => {
  const tokenEncrypted = encrypt(config.accessToken, encryptionKey)
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM seller_hub.integration_account
     WHERE marketplace = 'shopify' AND managed = false ORDER BY created_at LIMIT 1`
  )
  const existingId = existing.rows[0]?.id
  if (existingId) {
    const { rows } = await pool.query<AccountRow>(
      `UPDATE seller_hub.integration_account
       SET shop_domain = $1, shopify_location_id = $2,
           access_token_encrypted = $3, status = 'connected', updated_at = now()
       WHERE id = $4
       RETURNING id, shop_domain, shopify_location_id`,
      [config.shopDomain, config.locationId, tokenEncrypted, existingId]
    )
    return toResult(rows[0]!)
  }
  const { rows } = await pool.query<AccountRow>(
    `INSERT INTO seller_hub.integration_account
       (marketplace, status, shop_domain, shopify_location_id, access_token_encrypted)
     VALUES ('shopify', 'connected', $1, $2, $3)
     RETURNING id, shop_domain, shopify_location_id`,
    [config.shopDomain, config.locationId, tokenEncrypted]
  )
  return toResult(rows[0]!)
}
