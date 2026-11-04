import { buildReviewUpsertInput } from "../upsert-review"

const input = {
  product_id: "prod_1",
  customer_id: "cus_1",
  rating: 4,
  title: "Good",
  comment: "Works well",
}

describe("buildReviewUpsertInput", () => {
  it("builds a create payload with pending status and the order id when no existing review", () => {
    const result = buildReviewUpsertInput(null, input, "order_1")
    expect(result.mode).toBe("create")
    expect(result.data).toMatchObject({
      ...input,
      status: "pending",
      order_id: "order_1",
    })
  })

  it("builds an update payload targeting the existing review's id, resetting status to pending", () => {
    const result = buildReviewUpsertInput(
      { id: "review_1" },
      input,
      "order_1"
    )
    expect(result.mode).toBe("update")
    if (result.mode === "update") {
      expect(result.id).toBe("review_1")
    }
    expect(result.data).toMatchObject({
      ...input,
      status: "pending",
      order_id: "order_1",
    })
  })
})
