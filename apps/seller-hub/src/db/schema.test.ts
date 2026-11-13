import { expect, test } from "vitest"
import { SCHEMA_SQL } from "./schema.js"

test("schema adds the Shopify columns idempotently", () => {
  const expected = [
    ["integration_account", "shop_domain"],
    ["integration_account", "access_token_encrypted"],
    ["integration_account", "shopify_location_id"],
    ["channel_listing", "external_variant_id"],
    ["channel_listing", "external_inventory_item_id"],
  ]
  for (const [table, col] of expected) {
    expect(SCHEMA_SQL).toContain(
      `ALTER TABLE seller_hub.${table} ADD COLUMN IF NOT EXISTS ${col} TEXT;`
    )
  }
})
