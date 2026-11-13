import type { Pool } from "pg"
import { decrypt, encrypt } from "../crypto/secret-box.js"
import { loadShopifyConfig, type ShopifyConfig } from "../shopify/config.js"
import { loadWooCommerceConfig, type WooCommerceConfig } from "../woocommerce/config.js"

export type Marketplace = "shopify" | "woocommerce"
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

export type ConnectionRow = {
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
  constructor(fields: string[], message?: string) {
    super(message ?? `Missing or invalid fields: ${fields.join(", ")}`)
    this.name = "ConnectionInputError"
    this.fields = fields
  }
}

type StoredRow = {
  shop_domain: string | null
  shopify_location_id: string | null
  api_key: string | null
  access_token_encrypted: string | null
  webhook_secret_encrypted: string | null
}

const loadRow = async (pool: Pool, marketplace: Marketplace): Promise<StoredRow | null> => {
  const { rows } = await pool.query<StoredRow>(
    `SELECT shop_domain, shopify_location_id, api_key,
            access_token_encrypted, webhook_secret_encrypted
     FROM seller_hub.integration_account
     WHERE marketplace = $1 ORDER BY created_at LIMIT 1`,
    [marketplace]
  )
  return rows[0] ?? null
}

/** Database connection = a row carrying an encrypted webhook secret (env-start rows have none). */
export const resolveShopifyConfig = async (
  pool: Pool,
  encryptionKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ config: ShopifyConfig; source: ConfigSource } | null> => {
  const row = await loadRow(pool, "shopify")
  if (
    row?.webhook_secret_encrypted &&
    row.access_token_encrypted &&
    row.shop_domain &&
    row.shopify_location_id
  ) {
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

export const resolveWooConfig = async (
  pool: Pool,
  encryptionKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ config: WooCommerceConfig; source: ConfigSource } | null> => {
  const row = await loadRow(pool, "woocommerce")
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
    throw new ConnectionInputError(["siteUrl"], "siteUrl must start with https://")
  }
  return merged
}

/** Upserts the single row for the marketplace, storing every secret encrypted. */
export const saveConnection = async (
  pool: Pool,
  encryptionKey: string,
  marketplace: Marketplace,
  config: ShopifyConfig | WooCommerceConfig,
  salesChannelId?: string | null
): Promise<void> => {
  const isShopify = marketplace === "shopify"
  const shopify = config as ShopifyConfig
  const wooCfg = config as WooCommerceConfig
  const columns: [string, unknown][] = [
    ["shop_domain", isShopify ? shopify.shopDomain : wooCfg.siteUrl],
    ["access_token_encrypted", encrypt(isShopify ? shopify.accessToken : wooCfg.consumerSecret, encryptionKey)],
    ["webhook_secret_encrypted", encrypt(config.webhookSecret, encryptionKey)],
  ]
  if (isShopify) columns.push(["shopify_location_id", shopify.locationId])
  else columns.push(["api_key", wooCfg.consumerKey])
  if (salesChannelId !== undefined) columns.push(["medusa_sales_channel_id", salesChannelId])

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM seller_hub.integration_account
     WHERE marketplace = $1 ORDER BY created_at LIMIT 1`,
    [marketplace]
  )
  if (existing.rows[0]) {
    const sets = columns.map(([c], i) => `${c} = $${i + 1}`).join(", ")
    await pool.query(
      `UPDATE seller_hub.integration_account
       SET ${sets}, status = 'connected', last_error = NULL, updated_at = now()
       WHERE marketplace = $${columns.length + 1}`,
      [...columns.map(([, v]) => v), marketplace]
    )
    return
  }
  const names = ["marketplace", "status", ...columns.map(([c]) => c)].join(", ")
  const placeholders = ["$1", "'connected'", ...columns.map((_, i) => `$${i + 2}`)].join(", ")
  await pool.query(
    `INSERT INTO seller_hub.integration_account (${names}) VALUES (${placeholders})`,
    [marketplace, ...columns.map(([, v]) => v)]
  )
}

/** Wipes credentials but keeps the row so listings and history stay attached. */
export const clearConnection = async (pool: Pool, marketplace: Marketplace): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.integration_account
     SET shop_domain = NULL, access_token_encrypted = NULL, api_key = NULL,
         shopify_location_id = NULL, webhook_secret_encrypted = NULL,
         medusa_sales_channel_id = NULL, status = 'disconnected',
         last_error = NULL, updated_at = now()
     WHERE marketplace = $1`,
    [marketplace]
  )
}

export const setConnectionStatus = async (
  pool: Pool,
  marketplace: Marketplace,
  status: "connected" | "disconnected" | "error",
  lastError: string | null
): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.integration_account
     SET status = $1, last_error = $2, updated_at = now()
     WHERE marketplace = $3`,
    [status, lastError, marketplace]
  )
}

type ListRow = {
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

/** Status view for the admin UI. Selects no secret columns' values. */
export const listConnectionRows = async (pool: Pool): Promise<ConnectionRow[]> => {
  const { rows } = await pool.query<ListRow>(
    `SELECT a.marketplace, a.status, a.last_error, a.last_synced_at,
            a.medusa_sales_channel_id,
            (SELECT count(*) FROM seller_hub.channel_listing l
              WHERE l.integration_account_id = a.id) AS linked_listings,
            (a.webhook_secret_encrypted IS NOT NULL) AS has_stored_credentials,
            a.shop_domain, a.shopify_location_id,
            (a.api_key IS NOT NULL) AS api_key_present
     FROM seller_hub.integration_account a
     ORDER BY a.created_at`
  )
  return rows.map((r) => ({
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
