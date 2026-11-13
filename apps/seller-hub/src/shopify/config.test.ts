import { expect, test } from "vitest"
import { loadShopifyConfig } from "./config.js"

const full = {
  SHOPIFY_SHOP_DOMAIN: "shop.myshopify.com",
  SHOPIFY_ACCESS_TOKEN: "shpat_x",
  SHOPIFY_WEBHOOK_SECRET: "whsec",
  SHOPIFY_LOCATION_ID: "123",
}

test("returns the config when all four variables are set", () => {
  expect(loadShopifyConfig(full)).toEqual({
    shopDomain: "shop.myshopify.com",
    accessToken: "shpat_x",
    webhookSecret: "whsec",
    locationId: "123",
  })
})

for (const key of Object.keys(full)) {
  test(`returns null when ${key} is missing`, () => {
    const env = { ...full } as Record<string, string | undefined>
    delete env[key]
    expect(loadShopifyConfig(env)).toBeNull()
  })
  test(`returns null when ${key} is empty`, () => {
    expect(loadShopifyConfig({ ...full, [key]: "" })).toBeNull()
  })
}
