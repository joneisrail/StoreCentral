export type AdminReviewListItem = {
  id: string
  rating: number
  title: string
  comment: string
  status: string
  // query.graph's real "review" entity type returns created_at as
  // `string | Date` (mikro-orm hydrates it as a Date, not always a
  // serialized string) -- this is passed through unchanged (same as
  // this repo's other admin list routes, e.g.
  // src/api/admin/fulfillment-queue/build-queue-page.ts's FulfillmentQueueOrder,
  // which also leaves created_at for the client to parse), so the output
  // type matches the input type rather than lying about it with a cast.
  created_at: string | Date
  product: { id: string; title: string } | null
  customer: { id: string; email: string } | null
}

export type AdminReviewListRow = {
  id: string
  rating: number
  title: string
  comment: string
  status: string
  created_at: string | Date
  product:
    | { id: string; title: string | null | undefined }
    | null
    | undefined
  customer:
    | { id: string; email: string | null | undefined }
    | null
    | undefined
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
    // query.graph's real "product"/"customer" relation types mark
    // title/email as possibly null/undefined (Maybe<string>) even
    // though in practice a product always has a title and a reviewing
    // customer always has an email -- coalesced to "" rather than
    // widening the response contract to a nullable string the admin UI
    // would then have to guard against everywhere.
    product: review.product
      ? { id: review.product.id, title: review.product.title ?? "" }
      : null,
    customer: review.customer
      ? { id: review.customer.id, email: review.customer.email ?? "" }
      : null,
  }
}
