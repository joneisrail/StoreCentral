/**
 * DDL for the `seller_hub` Postgres schema. Kept as a TS string constant
 * (rather than a loose `.sql` file read from disk at runtime) so it survives
 * `tsc` compilation as-is — a static asset copy step would be needed
 * otherwise, since `dist/` only contains compiled `.js` output.
 */
export const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS seller_hub;

CREATE TABLE IF NOT EXISTS seller_hub.integration_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace TEXT NOT NULL,              -- 'amazon'
  status TEXT NOT NULL DEFAULT 'disconnected', -- 'connected' | 'disconnected' | 'error'
  lwa_refresh_token_encrypted TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_hub.channel_listing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id UUID NOT NULL REFERENCES seller_hub.integration_account(id),
  medusa_product_id TEXT NOT NULL,
  medusa_variant_id TEXT NOT NULL,
  external_sku TEXT NOT NULL,
  external_asin TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- 'draft'|'pending'|'published'|'rejected'|'error'
  price_rule JSONB,                        -- e.g. {"type":"percentage","value":10}
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_account_id, external_sku)
);

-- Task 11: lets reconciliation detect drift between Medusa's current
-- inventory/price and what was last successfully pushed to Amazon, without
-- re-fetching Amazon's own current state (out of scope for this
-- product-sync-only Listings integration). Set by Task 8's
-- pushInventoryUpdate/pushPriceUpdate on success.
ALTER TABLE seller_hub.channel_listing ADD COLUMN IF NOT EXISTS last_synced_quantity INT;
ALTER TABLE seller_hub.channel_listing ADD COLUMN IF NOT EXISTS last_synced_price NUMERIC;

CREATE TABLE IF NOT EXISTS seller_hub.sync_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id UUID NOT NULL REFERENCES seller_hub.integration_account(id),
  sync_type TEXT NOT NULL,                -- 'product'|'inventory'|'price'|'order'
  external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'processing'|'succeeded'|'failed'
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  medusa_entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_account_id, sync_type, external_id)
);

-- Shopify connector: account credentials/location and per-listing Shopify ids.
ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS shop_domain TEXT;
ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT;
ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS shopify_location_id TEXT;
ALTER TABLE seller_hub.channel_listing ADD COLUMN IF NOT EXISTS external_variant_id TEXT;
ALTER TABLE seller_hub.channel_listing ADD COLUMN IF NOT EXISTS external_inventory_item_id TEXT;

-- WooCommerce connector: consumer key and the parent product id for variations.
ALTER TABLE seller_hub.integration_account ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE seller_hub.channel_listing ADD COLUMN IF NOT EXISTS external_parent_id TEXT;
`
