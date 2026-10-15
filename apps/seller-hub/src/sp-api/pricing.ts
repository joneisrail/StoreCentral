import type { SpApiClient } from "./client.js"

export type SubmitPriceUpdateInput = {
  sku: string
  amount: number
  currencyCode: string
}

// Same Feeds API resource/rate limit as `sp-api/listings.ts`'s
// `submitListingFeed` — Amazon's price-update feed type goes through the
// identical `createFeed` endpoint, just with a different `feedType`.
const CREATE_FEED_RATE_LIMIT = { ratePerSecond: 0.0083, burst: 15 }

/**
 * Submits a price update to Amazon. Modeled as a Feeds API submission
 * (`POST_PRODUCT_PRICING_DATA`), the same mechanism Amazon uses for bulk
 * price updates via `POST /feeds/2021-06-30/feeds` (see `sp-api/listings.ts`
 * for why the feed-document-upload step is skipped here).
 */
export const submitPriceUpdate = async (
  client: SpApiClient,
  input: SubmitPriceUpdateInput
): Promise<{ feedId: string }> => {
  return client.request<{ feedId: string }>({
    name: "submitPriceUpdate",
    method: "POST",
    path: "/feeds/2021-06-30/feeds",
    body: {
      feedType: "POST_PRODUCT_PRICING_DATA",
      sku: input.sku,
      amount: input.amount,
      currencyCode: input.currencyCode,
    },
    rateLimit: CREATE_FEED_RATE_LIMIT,
  })
}
