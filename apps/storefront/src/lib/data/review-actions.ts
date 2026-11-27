"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders } from "./cookies"
import { listReviews, type ReviewsPage } from "./reviews"

export type CreateReviewResult = { ok: true } | { ok: false; error: string }
export type LoadMoreResult = { ok: true; page: ReviewsPage } | { ok: false }

// Server actions mask thrown messages in production, so these never throw and
// the error texts are fixed.
export async function createReview(input: {
  productId: string
  rating: number
  title: string
  comment: string
}): Promise<CreateReviewResult> {
  try {
    const headers = await getAuthHeaders()
    if (!("authorization" in headers)) {
      return { ok: false, error: "Sign in to write a review" }
    }
    await sdk.client.fetch(`/store/reviews`, {
      method: "POST",
      headers,
      body: {
        product_id: input.productId,
        rating: input.rating,
        title: input.title,
        comment: input.comment,
      },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: "Couldn't submit your review. Please try again." }
  }
}

export async function loadMore(
  productId: string,
  offset: number
): Promise<LoadMoreResult> {
  const page = await listReviews(productId, offset)
  return page ? { ok: true, page } : { ok: false }
}
