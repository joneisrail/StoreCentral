export type WooCommerceConfig = {
  siteUrl: string
  consumerKey: string
  consumerSecret: string
  webhookSecret: string
}

/**
 * Reads the WooCommerce connector settings. Returns null (never throws) when
 * any variable is missing or empty, or the site URL is not https, so the
 * connector stays optional. Never logs the values.
 */
export const loadWooCommerceConfig = (
  env: NodeJS.ProcessEnv = process.env
): WooCommerceConfig | null => {
  const siteUrl = env.WOOCOMMERCE_SITE_URL
  const consumerKey = env.WOOCOMMERCE_CONSUMER_KEY
  const consumerSecret = env.WOOCOMMERCE_CONSUMER_SECRET
  const webhookSecret = env.WOOCOMMERCE_WEBHOOK_SECRET
  if (!siteUrl || !consumerKey || !consumerSecret || !webhookSecret) return null
  if (!siteUrl.startsWith("https://")) {
    console.warn(
      "[seller-hub] WooCommerce disabled: WOOCOMMERCE_SITE_URL must start with https://"
    )
    return null
  }
  return {
    siteUrl: siteUrl.replace(/\/+$/, ""),
    consumerKey,
    consumerSecret,
    webhookSecret,
  }
}
