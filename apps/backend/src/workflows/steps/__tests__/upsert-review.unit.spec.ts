import { MedusaError } from "@medusajs/framework/utils"
import { buildReviewUpsertInput, isDuplicateReviewError } from "../upsert-review"

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

describe("isDuplicateReviewError", () => {
  it("returns true for the MedusaError shape the DB layer raises on a unique-constraint violation", () => {
    const error = new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Review with customer_id: cus_1, product_id: prod_1, already exists."
    )
    expect(isDuplicateReviewError(error)).toBe(true)
  })

  it("returns false for a MedusaError of a different type", () => {
    const error = new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Review with customer_id: cus_1, product_id: prod_1, already exists."
    )
    expect(isDuplicateReviewError(error)).toBe(false)
  })

  it("returns false for an INVALID_DATA MedusaError unrelated to a duplicate", () => {
    const error = new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cannot set field 'rating' of Review to null"
    )
    expect(isDuplicateReviewError(error)).toBe(false)
  })

  it("returns false for a plain Error", () => {
    expect(isDuplicateReviewError(new Error("boom"))).toBe(false)
  })

  it("returns false for a non-error value", () => {
    expect(isDuplicateReviewError(null)).toBe(false)
    expect(isDuplicateReviewError(undefined)).toBe(false)
    expect(isDuplicateReviewError("nope")).toBe(false)
  })
})
