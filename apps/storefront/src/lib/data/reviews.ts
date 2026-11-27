import { sdk } from "@lib/config"

export type PublicReviewDto = {
  id: string
  rating: number
  title: string
  comment: string
  created_at: string
  author: string
}

export type ReviewsPage = {
  reviews: PublicReviewDto[]
  count: number
  average: number | null
}

export const REVIEWS_PAGE_SIZE = 10

/** Fetches one page of approved reviews. Returns null on any failure. */
export async function listReviews(
  productId: string,
  offset = 0
): Promise<ReviewsPage | null> {
  try {
    const res = await sdk.client.fetch<{
      reviews: PublicReviewDto[]
      count: number
      average: number | null
    }>(`/store/products/${encodeURIComponent(productId)}/reviews`, {
      method: "GET",
      query: { limit: REVIEWS_PAGE_SIZE, offset },
    })
    if (!res || !Array.isArray(res.reviews)) {
      return null
    }
    return {
      reviews: res.reviews,
      count: res.count ?? res.reviews.length,
      average: res.average ?? null,
    }
  } catch {
    return null
  }
}
