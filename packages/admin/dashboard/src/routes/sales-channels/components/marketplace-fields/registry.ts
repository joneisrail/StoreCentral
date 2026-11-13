export type MarketplaceType = "none" | "shopify" | "woocommerce" | "amazon"

export type FieldDef = {
  name: string
  label: string
  secret: boolean
  required: boolean
  help?: string
  placeholder?: string
  defaultValue?: string
}

export type MarketplaceDef = {
  label: string
  fields: FieldDef[]
  syncLive: boolean
}

// Field names are the snake_case keys the backend expects. WordPress is the
// display label of the "woocommerce" marketplace key.
export const MARKETPLACES: Record<
  Exclude<MarketplaceType, "none">,
  MarketplaceDef
> = {
  shopify: {
    label: "Shopify",
    syncLive: true,
    fields: [
      {
        name: "shop_domain",
        label: "Shop domain",
        secret: false,
        required: true,
        placeholder: "my-store.myshopify.com",
      },
      {
        name: "access_token",
        label: "Access token",
        secret: true,
        required: true,
      },
      {
        name: "webhook_secret",
        label: "Webhook secret",
        secret: true,
        required: true,
      },
      {
        name: "location_id",
        label: "Location ID",
        secret: false,
        required: true,
      },
    ],
  },
  woocommerce: {
    label: "WordPress",
    syncLive: true,
    fields: [
      {
        name: "site_url",
        label: "Site URL",
        secret: false,
        required: true,
        placeholder: "https://example.com",
      },
      {
        name: "consumer_key",
        label: "Consumer key",
        secret: false,
        required: true,
      },
      {
        name: "consumer_secret",
        label: "Consumer secret",
        secret: true,
        required: true,
      },
      {
        name: "webhook_secret",
        label: "Webhook secret",
        secret: true,
        required: true,
      },
    ],
  },
  amazon: {
    label: "Amazon",
    syncLive: false,
    fields: [
      { name: "seller_id", label: "Seller ID", secret: false, required: true },
      {
        name: "marketplace_id",
        label: "Marketplace ID",
        secret: false,
        required: true,
        defaultValue: "ATVPDKIKX0DER",
      },
      {
        name: "refresh_token",
        label: "Refresh token",
        secret: true,
        required: true,
      },
    ],
  },
}

export const MARKETPLACE_KEYS = Object.keys(MARKETPLACES) as Exclude<
  MarketplaceType,
  "none"
>[]

export const defaultCredentials = (
  marketplace: MarketplaceType
): Record<string, string> => {
  if (marketplace === "none") {
    return {}
  }
  const values: Record<string, string> = {}
  for (const field of MARKETPLACES[marketplace].fields) {
    values[field.name] = field.defaultValue ?? ""
  }
  return values
}
