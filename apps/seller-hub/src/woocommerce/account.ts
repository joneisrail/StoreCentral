import type { Pool } from "pg"
import { encrypt } from "../crypto/secret-box.js"
import type { WooCommerceConfig } from "./config.js"

type AccountRow = { id: string; shop_domain: string }

const toResult = (row: AccountRow) => ({ id: row.id, siteUrl: row.shop_domain })

/**
 * Finds or creates the single WooCommerce integration_account row and
 * refreshes its site URL, consumer key and (encrypted) consumer secret.
 * Idempotent.
 */
export const resolveWooCommerceAccount = async (
  pool: Pool,
  config: WooCommerceConfig,
  encryptionKey: string
): Promise<{ id: string; siteUrl: string }> => {
  const secretEncrypted = encrypt(config.consumerSecret, encryptionKey)
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM seller_hub.integration_account
     WHERE marketplace = 'woocommerce' ORDER BY created_at LIMIT 1`
  )
  const existingId = existing.rows[0]?.id
  if (existingId) {
    const { rows } = await pool.query<AccountRow>(
      `UPDATE seller_hub.integration_account
       SET shop_domain = $1, api_key = $2,
           access_token_encrypted = $3, status = 'connected', updated_at = now()
       WHERE id = $4
       RETURNING id, shop_domain`,
      [config.siteUrl, config.consumerKey, secretEncrypted, existingId]
    )
    return toResult(rows[0]!)
  }
  const { rows } = await pool.query<AccountRow>(
    `INSERT INTO seller_hub.integration_account
       (marketplace, status, shop_domain, api_key, access_token_encrypted)
     VALUES ('woocommerce', 'connected', $1, $2, $3)
     RETURNING id, shop_domain`,
    [config.siteUrl, config.consumerKey, secretEncrypted]
  )
  return toResult(rows[0]!)
}
