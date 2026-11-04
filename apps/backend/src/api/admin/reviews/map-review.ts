export type AdminReviewListItem = {
  id: string
  rating: number
  title: string
  comment: string
  status: string
  created_at: string
  product: { id: string; title: string } | null
  customer: { id: string; email: string } | null
}

export type AdminReviewListRow = {
  id: string
  rating: number
  title: string
  comment: string
  status: string
  created_at: string
  product: { id: string; title: string } | null | undefined
  customer: { id: string; email: string } | null | undefined
}

/**
 * Pure mapper from a `review` entity row (as returned by `query.graph` with
 * the linked `product.*`/`customer.*` fields requested) to the admin list
 * response shape. A review's product or customer link can be missing (e.g.
 * the product or customer was later deleted), so both are substituted with
 * `null` rather than assumed present.
 */
export function mapReviewForAdminList(
  review: AdminReviewListRow
): AdminReviewListItem {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    status: review.status,
    created_at: review.created_at,
    product: review.product
      ? { id: review.product.id, title: review.product.title }
      : null,
    customer: review.customer
      ? { id: review.customer.id, email: review.customer.email }
      : null,
  }
}
