import type { SpApiClient } from "./client.js"

export type SubmitListingFeedInput = {
  sku: string
  asin?: string
  attributes: Record<string, unknown>
}

export type FeedProcessingStatus = "DONE" | "IN_PROGRESS" | "CANCELLED" | "FATAL"

export type FeedResult = {
  status: FeedProcessingStatus
  errors?: string[]
}

// Amazon's published SP-API rate limits for the Feeds API resource
// (createFeed: 0.0083 req/s, burst 15; getFeed: 2 req/s, burst 15).
// Precision doesn't matter much here since this task mocks `SpApiClient`
// entirely — kept for consistency with Task 4's `SpApiOperation.rateLimit`
// contract, which `SpApiClient.request` requires on every call.
const CREATE_FEED_RATE_LIMIT = { ratePerSecond: 0.0083, burst: 15 }
const GET_FEED_RATE_LIMIT = { ratePerSecond: 2, burst: 15 }

/**
 * Submits a product/inventory listing update to Amazon via the SP-API
 * Feeds API. Inventory is part of the same "listings" feed in SP-API (there
 * is no separate inventory-only submission endpoint), so `pushInventoryUpdate`
 * and `pushProductListing` both go through this one function with different
 * `attributes`.
 *
 * Real SP-API's Feeds API is a two-step document upload (`createFeedDocument`
 * -> PUT the feed content to the returned pre-signed URL -> `createFeed`
 * referencing that document); this task's brief specifies a single
 * `submitListingFeed(client, input)` call, so the feed payload is sent
 * directly as this operation's body rather than modeling that upload step.
 * Modeled on `POST /feeds/2021-06-30/feeds`, which responds `{ feedId }`.
 */
export const submitListingFeed = async (
  client: SpApiClient,
  input: SubmitListingFeedInput
): Promise<{ feedId: string }> => {
  return client.request<{ feedId: string }>({
    name: "submitListingFeed",
    method: "POST",
    path: "/feeds/2021-06-30/feeds",
    body: {
      feedType: "POST_PRODUCT_DATA",
      sku: input.sku,
      asin: input.asin,
      attributes: input.attributes,
    },
    rateLimit: CREATE_FEED_RATE_LIMIT,
  })
}

/**
 * Polls the processing result of a feed previously submitted via
 * `submitListingFeed`/`submitPriceUpdate`. Modeled on
 * `GET /feeds/2021-06-30/feeds/{feedId}`.
 */
export const getFeedResult = async (
  client: SpApiClient,
  feedId: string
): Promise<FeedResult> => {
  return client.request<FeedResult>({
    name: "getFeedResult",
    method: "GET",
    path: `/feeds/2021-06-30/feeds/${feedId}`,
    rateLimit: GET_FEED_RATE_LIMIT,
  })
}
