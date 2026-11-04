import { mapReviewForAdminList } from "../map-review"

function baseReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "review_1",
    rating: 5,
    title: "Great",
    comment: "Loved it",
    status: "pending",
    created_at: "2026-11-04T00:00:00.000Z",
    product: { id: "prod_1", title: "Widget" },
    customer: { id: "cus_1", email: "customer@example.com" },
    ...overrides,
  } as any
}

describe("mapReviewForAdminList", () => {
  it("passes product and customer through when present", () => {
    const result = mapReviewForAdminList(baseReview())
    expect(result.product).toEqual({ id: "prod_1", title: "Widget" })
  })

  it("maps a deleted/missing product to null instead of throwing", () => {
    const result = mapReviewForAdminList(baseReview({ product: null }))
    expect(result.product).toBeNull()
  })

  it("maps a deleted/missing customer to null instead of throwing", () => {
    const result = mapReviewForAdminList(baseReview({ customer: null }))
    expect(result.customer).toBeNull()
  })

  it("passes the review's scalar fields through unchanged", () => {
    const result = mapReviewForAdminList(baseReview())
    expect(result).toMatchObject({
      id: "review_1",
      rating: 5,
      title: "Great",
      comment: "Loved it",
      status: "pending",
      created_at: "2026-11-04T00:00:00.000Z",
      customer: { id: "cus_1", email: "customer@example.com" },
    })
  })
})
