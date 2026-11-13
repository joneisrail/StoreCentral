export type ShopifyConfig = {
  shopDomain: string
  accessToken: string
  webhookSecret: string
  locationId: string
}

/**
 * Reads the Shopify connector settings. Returns null (never throws) when any
 * variable is missing or empty, so the Shopify connector stays optional.
 */
export const loadShopifyConfig = (
  env: NodeJS.ProcessEnv = process.env
): ShopifyConfig | null => {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN
  const accessToken = env.SHOPIFY_ACCESS_TOKEN
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET
  const locationId = env.SHOPIFY_LOCATION_ID
  if (!shopDomain || !accessToken || !webhookSecret || !locationId) return null
  return { shopDomain, accessToken, webhookSecret, locationId }
}
