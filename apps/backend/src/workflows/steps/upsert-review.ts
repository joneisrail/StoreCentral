import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { REVIEW_MODULE } from "../../modules/review"
import ReviewModuleService from "../../modules/review/service"

type Review = {
  id: string
  product_id: string
  customer_id: string
  order_id: string | null
  rating: number
  title: string
  comment: string
  status: "pending" | "approved" | "rejected"
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

type ReviewInput = {
  product_id: string
  customer_id: string
  rating: number
  title: string
  comment: string
}

export function buildReviewUpsertInput(
  existing: { id: string } | null,
  input: ReviewInput,
  orderId: string
):
  | { mode: "create"; data: Record<string, unknown> }
  | { mode: "update"; id: string; data: Record<string, unknown> } {
  const data = {
    product_id: input.product_id,
    customer_id: input.customer_id,
    rating: input.rating,
    title: input.title,
    comment: input.comment,
    status: "pending",
    order_id: orderId,
  }

  return existing
    ? { mode: "update", id: existing.id, data }
    : { mode: "create", data }
}

export const upsertReviewStep = createStep(
  "upsert-review",
  async (
    input: ReviewInput & { orderId: string },
    { container }
  ) => {
    const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)

    const existingReviews: { id: string }[] = await reviewModule.listReviews({
      customer_id: input.customer_id,
      product_id: input.product_id,
    })

    const upsertInput = buildReviewUpsertInput(
      existingReviews[0] ?? null,
      input,
      input.orderId
    )

    const review: Review =
      upsertInput.mode === "create"
        ? await reviewModule.createReviews(upsertInput.data)
        : await reviewModule.updateReviews({
            id: upsertInput.id,
            ...upsertInput.data,
          })

    const wasCreated = upsertInput.mode === "create"

    return new StepResponse(
      { review, wasCreated },
      { reviewId: review.id, wasCreated }
    )
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) {
      return
    }

    if (compensationInput.wasCreated) {
      const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)
      await reviewModule.deleteReviews(compensationInput.reviewId)
    }
  }
)
