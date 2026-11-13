import type { Pool } from "pg"
import { decrypt, encrypt } from "../crypto/secret-box.js"
import { loadShopifyConfig, type ShopifyConfig } from "../shopify/config.js"
import { loadWooCommerceConfig, type WooCommerceConfig } from "../woocommerce/config.js"

export type Marketplace = "shopify" | "woocommerce" | "amazon"
/** Marketplaces the legacy marketplace-keyed functions and runtimes still handle. */
export type LegacyMarketplace = "shopify" | "woocommerce"
export const DEFAULT_AMAZON_MARKETPLACE_ID = "ATVPDKIKX0DER"
export type ConfigSource = "database" | "environment" | "none"

export type ShopifyInput = {
  shopDomain?: string
  accessToken?: string
  webhookSecret?: string
  locationId?: string
}
export type WooInput = {
  siteUrl?: string
  consumerKey?: string
  consumerSecret?: string
  webhookSecret?: string
}

export type AmazonInput = { sellerId?: string; marketplaceId?: string; refreshToken?: string }
export type AmazonConfig = { sellerId: string; marketplaceId: string; refreshToken: string }
export type ConnectionStatus = "connected" | "disconnected" | "error"

export type ConnectionRow = {
  id: string
  displayName: string | null
  managed: boolean
  amazonSellerId: string | null
  amazonMarketplaceId: string | null
  marketplace: string
  status: string
  lastError: string | null
  lastSyncedAt: Date | null
  salesChannelId: string | null
  linkedListings: number
  hasStoredCredentials: boolean
  shopDomain: string | null
  shopifyLocationId: string | null
  apiKeyPresent: boolean
}

/** Thrown when a required connection field is missing or invalid. Never carries values. */
export class ConnectionInputError extends Error {
  fields: string[]
  /** `missing`: required values absent; `invalid`: a supplied value was rejected. */
  kind: "missing" | "invalid"
  constructor(fields: string[], message?: string, kind: "missing" | "invalid" = "missing") {
    super(message ?? `Missing or invalid fields: ${fields.join(", ")}`)
    this.name = "ConnectionInputError"
    this.fields = fields
    this.kind = kind
  }
}

type StoredRow = {
  shop_domain: string | null
  shopify_location_id: string | null
  api_key: string | null
  access_token_encrypted: string | null
  webhook_secret_encrypted: string | null
}

/** Blank/undefined/whitespace-only input means "keep the stored value". */
const pick = (input: string | undefined, stored: string | undefined): string => {
  const trimmed = input?.trim()
  return trimmed ? trimmed : (stored ?? "")
}

export const mergeShopifyInput = (
  stored: ShopifyConfig | null,
  input: ShopifyInput
): ShopifyConfig => {
  const merged: ShopifyConfig = {
    shopDomain: pick(input.shopDomain, stored?.shopDomain),
    accessToken: pick(input.accessToken, stored?.accessToken),
    webhookSecret: pick(input.webhookSecret, stored?.webhookSecret),
    locationId: pick(input.locationId, stored?.locationId),
  }
  const missing = (Object.keys(merged) as (keyof ShopifyConfig)[]).filter((k) => !merged[k])
  if (missing.length > 0) throw new ConnectionInputError(missing)
  return merged
}

export const mergeWooInput = (stored: WooCommerceConfig | null, input: WooInput): WooCommerceConfig => {
  const merged: WooCommerceConfig = {
    siteUrl: pick(input.siteUrl, stored?.siteUrl).replace(/\/+$/, ""),
    consumerKey: pick(input.consumerKey, stored?.consumerKey),
    consumerSecret: pick(input.consumerSecret, stored?.consumerSecret),
    webhookSecret: pick(input.webhookSecret, stored?.webhookSecret),
  }
  const missing = (Object.keys(merged) as (keyof WooCommerceConfig)[]).filter((k) => !merged[k])
  if (missing.length > 0) throw new ConnectionInputError(missing)
  if (!merged.siteUrl.startsWith("https://")) {
    throw new ConnectionInputError(["siteUrl"], "siteUrl must start with https://", "invalid")
  }
  return merged
}

export const mergeAmazonInput = (stored: AmazonConfig | null, input: AmazonInput): AmazonConfig => {
  const sellerId = pick(input.sellerId, stored?.sellerId)
  const refreshToken = pick(input.refreshToken, stored?.refreshToken)
  const missing: string[] = []
  if (!sellerId) missing.push("sellerId")
  if (!refreshToken) missing.push("refreshToken")
  if (missing.length > 0) throw new ConnectionInputError(missing)
  return {
    sellerId,
    marketplaceId: pick(input.marketplaceId, stored?.marketplaceId) || DEFAULT_AMAZON_MARKETPLACE_ID,
    refreshToken,
  }
}

const HAS_CREDENTIALS_SQL = `(CASE WHEN a.marketplace = 'amazon'
              THEN a.lwa_refresh_token_encrypted IS NOT NULL
              ELSE a.webhook_secret_encrypted IS NOT NULL END)`

type ListRow = {
  id: string
  display_name: string | null
  managed: boolean
  amazon_seller_id: string | null
  amazon_marketplace_id: string | null
  marketplace: string
  status: string
  last_error: string | null
  last_synced_at: Date | null
  medusa_sales_channel_id: string | null
  linked_listings: string | number
  has_stored_credentials: boolean
  shop_domain: string | null
  shopify_location_id: string | null
  api_key_present: boolean
}

/**
 * Status view for the admin UI: every row, managed first (by creation), then
 * legacy. Booleans stand in for secrets; no secret column value is selected.
 */
export const listConnectionRows = async (pool: Pool): Promise<ConnectionRow[]> => {
  const { rows } = await pool.query<ListRow>(
    `SELECT a.id, a.display_name, a.managed, a.amazon_seller_id, a.amazon_marketplace_id,
            a.marketplace, a.status, a.last_error, a.last_synced_at,
            a.medusa_sales_channel_id,
            (SELECT count(*) FROM seller_hub.channel_listing l
              WHERE l.integration_account_id = a.id) AS linked_listings,
            ${HAS_CREDENTIALS_SQL} AS has_stored_credentials,
            a.shop_domain, a.shopify_location_id,
            (a.api_key IS NOT NULL) AS api_key_present
     FROM seller_hub.integration_account a
     ORDER BY a.managed DESC, a.created_at`
  )
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name ?? null,
    managed: Boolean(r.managed),
    amazonSellerId: r.amazon_seller_id ?? null,
    amazonMarketplaceId: r.amazon_marketplace_id ?? null,
    marketplace: r.marketplace,
    status: r.status,
    lastError: r.last_error,
    lastSyncedAt: r.last_synced_at,
    salesChannelId: r.medusa_sales_channel_id,
    linkedListings: Number(r.linked_listings),
    hasStoredCredentials: r.has_stored_credentials,
    shopDomain: r.shop_domain,
    shopifyLocationId: r.shopify_location_id,
    apiKeyPresent: r.api_key_present,
  }))
}

/** Best-effort rollback of a row created moments ago (no listings can be attached yet). */
export const deleteConnectionRow = async (pool: Pool, id: string): Promise<void> => {
  await pool.query(`DELETE FROM seller_hub.integration_account WHERE id = $1 AND managed = true`, [id])
}

const UNIQUE_VIOLATION = "23505"

/** Inserts a managed, credential-less row for a sales channel and returns its id. */
export const createConnectionRow = async (
  pool: Pool,
  input: { marketplace: Marketplace; salesChannelId: string; displayName: string }
): Promise<string> => {
  const taken = await pool.query<{ id: string }>(
    `SELECT id FROM seller_hub.integration_account
     WHERE medusa_sales_channel_id = $1 LIMIT 1`,
    [input.salesChannelId]
  )
  if (taken.rows[0]) {
    throw new ConnectionInputError(["sales_channel_id"], "This sales channel already has a connection")
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO seller_hub.integration_account
         (marketplace, medusa_sales_channel_id, display_name, managed, status)
       VALUES ($1, $2, $3, true, 'disconnected')
       RETURNING id`,
      [input.marketplace, input.salesChannelId, input.displayName]
    )
    return rows[0]!.id
  } catch (e) {
    if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ConnectionInputError(["sales_channel_id"], "This sales channel already has a connection")
    }
    throw e
  }
}

type StoredByIdRow = {
  marketplace: string
  shop_domain: string | null
  shopify_location_id: string | null
  api_key: string | null
  access_token_encrypted: string | null
  webhook_secret_encrypted: string | null
  lwa_refresh_token_encrypted: string | null
  amazon_seller_id: string | null
  amazon_marketplace_id: string | null
}

/**
 * Decrypts the stored credentials of one row. Null when the row is missing or
 * holds no credentials; throws when ciphertext cannot be decrypted.
 */
export const loadStoredConfig = async (
  pool: Pool,
  encryptionKey: string,
  id: string
): Promise<ShopifyConfig | WooCommerceConfig | AmazonConfig | null> => {
  const { rows } = await pool.query<StoredByIdRow>(
    `SELECT marketplace, shop_domain, shopify_location_id, api_key,
            access_token_encrypted, webhook_secret_encrypted,
            lwa_refresh_token_encrypted, amazon_seller_id, amazon_marketplace_id
     FROM seller_hub.integration_account WHERE id = $1`,
    [id]
  )
  const row = rows[0]
  if (!row) return null
  if (row.marketplace === "amazon") {
    if (!row.lwa_refresh_token_encrypted || !row.amazon_seller_id) return null
    return {
      sellerId: row.amazon_seller_id,
      marketplaceId: row.amazon_marketplace_id ?? DEFAULT_AMAZON_MARKETPLACE_ID,
      refreshToken: decrypt(row.lwa_refresh_token_encrypted, encryptionKey),
    }
  }
  if (!row.webhook_secret_encrypted || !row.access_token_encrypted || !row.shop_domain) return null
  if (row.marketplace === "shopify") {
    if (!row.shopify_location_id) return null
    return {
      shopDomain: row.shop_domain,
      accessToken: decrypt(row.access_token_encrypted, encryptionKey),
      webhookSecret: decrypt(row.webhook_secret_encrypted, encryptionKey),
      locationId: row.shopify_location_id,
    }
  }
  if (!row.api_key) return null
  return {
    siteUrl: row.shop_domain,
    consumerKey: row.api_key,
    consumerSecret: decrypt(row.access_token_encrypted, encryptionKey),
    webhookSecret: decrypt(row.webhook_secret_encrypted, encryptionKey),
  }
}

/** Stores one row's credentials encrypted and records the resulting status. */
export const saveConnectionById = async (
  pool: Pool,
  encryptionKey: string,
  id: string,
  config: ShopifyConfig | WooCommerceConfig | AmazonConfig,
  status: ConnectionStatus,
  lastError: string | null
): Promise<void> => {
  const found = await pool.query<{ marketplace: string }>(
    `SELECT marketplace FROM seller_hub.integration_account WHERE id = $1`,
    [id]
  )
  const marketplace = found.rows[0]?.marketplace
  if (!marketplace) throw new Error("Connection not found")
  let columns: [string, unknown][]
  if (marketplace === "shopify") {
    const c = config as ShopifyConfig
    columns = [
      ["shop_domain", c.shopDomain],
      ["access_token_encrypted", encrypt(c.accessToken, encryptionKey)],
      ["webhook_secret_encrypted", encrypt(c.webhookSecret, encryptionKey)],
      ["shopify_location_id", c.locationId],
    ]
  } else if (marketplace === "woocommerce") {
    const c = config as WooCommerceConfig
    columns = [
      ["shop_domain", c.siteUrl],
      ["api_key", c.consumerKey],
      ["access_token_encrypted", encrypt(c.consumerSecret, encryptionKey)],
      ["webhook_secret_encrypted", encrypt(c.webhookSecret, encryptionKey)],
    ]
  } else {
    const c = config as AmazonConfig
    columns = [
      ["amazon_seller_id", c.sellerId],
      ["amazon_marketplace_id", c.marketplaceId],
      ["lwa_refresh_token_encrypted", encrypt(c.refreshToken, encryptionKey)],
    ]
  }
  columns.push(["status", status], ["last_error", lastError])
  const sets = columns.map(([c], i) => `${c} = $${i + 1}`).join(", ")
  await pool.query(
    `UPDATE seller_hub.integration_account
     SET ${sets}, updated_at = now()
     WHERE id = $${columns.length + 1}`,
    [...columns.map(([, v]) => v), id]
  )
}

/** Wipes credentials; keeps the row, its listings and its sales channel link. */
export const clearConnectionById = async (pool: Pool, id: string): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.integration_account
     SET shop_domain = NULL, access_token_encrypted = NULL, api_key = NULL,
         shopify_location_id = NULL, webhook_secret_encrypted = NULL,
         lwa_refresh_token_encrypted = NULL, amazon_seller_id = NULL,
         amazon_marketplace_id = NULL, status = 'disconnected',
         last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id]
  )
}

export const setStatusById = async (
  pool: Pool,
  id: string,
  status: ConnectionStatus,
  lastError: string | null
): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.integration_account
     SET status = $1, last_error = $2, updated_at = now()
     WHERE id = $3`,
    [status, lastError, id]
  )
}

type LegacyRow = StoredRow & { managed: boolean }

/**
 * Env / unmanaged-row configuration for the pre-existing single-account path.
 * Used only while no managed row exists for the marketplace; Amazon stays
 * env-driven elsewhere, so it yields null here.
 */
export const resolveLegacyConfig = async (
  pool: Pool,
  encryptionKey: string,
  marketplace: Marketplace,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ config: ShopifyConfig | WooCommerceConfig; source: ConfigSource } | null> => {
  if (marketplace === "amazon") return null
  const { rows } = await pool.query<LegacyRow>(
    `SELECT managed, shop_domain, shopify_location_id, api_key,
            access_token_encrypted, webhook_secret_encrypted
     FROM seller_hub.integration_account
     WHERE marketplace = $1 ORDER BY created_at`,
    [marketplace]
  )
  if (rows.some((r) => r.managed)) return null
  const row = rows[0]
  if (marketplace === "shopify") {
    if (row?.webhook_secret_encrypted && row.access_token_encrypted && row.shop_domain && row.shopify_location_id) {
      return {
        source: "database",
        config: {
          shopDomain: row.shop_domain,
          accessToken: decrypt(row.access_token_encrypted, encryptionKey),
          webhookSecret: decrypt(row.webhook_secret_encrypted, encryptionKey),
          locationId: row.shopify_location_id,
        },
      }
    }
    const fromEnv = loadShopifyConfig(env)
    return fromEnv ? { config: fromEnv, source: "environment" } : null
  }
  if (row?.webhook_secret_encrypted && row.access_token_encrypted && row.shop_domain && row.api_key) {
    return {
      source: "database",
      config: {
        siteUrl: row.shop_domain,
        consumerKey: row.api_key,
        consumerSecret: decrypt(row.access_token_encrypted, encryptionKey),
        webhookSecret: decrypt(row.webhook_secret_encrypted, encryptionKey),
      },
    }
  }
  const fromEnv = loadWooCommerceConfig(env)
  return fromEnv ? { config: fromEnv, source: "environment" } : null
}
