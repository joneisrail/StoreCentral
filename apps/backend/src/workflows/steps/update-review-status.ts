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

type UpdateReviewStatusStepInput = {
  reviewId: string
  status: "approved" | "rejected"
}

export const updateReviewStatusStep = createStep(
  "update-review-status",
  async (input: UpdateReviewStatusStepInput, { container }) => {
    const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)

    // Let NOT_FOUND propagate untouched for a bad id -- this must 404, not
    // 400, so we never catch it here. Retrieving first also means a bad id
    // fails before any write is attempted.
    const existing: Review = await reviewModule.retrieveReview(input.reviewId)
    const previousStatus = existing.status

    const review: Review = await reviewModule.updateReviews({
      id: input.reviewId,
      status: input.status,
    })

    return new StepResponse(review, {
      reviewId: input.reviewId,
      previousStatus,
    })
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) {
      return
    }

    const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)
    await reviewModule.updateReviews({
      id: compensationInput.reviewId,
      status: compensationInput.previousStatus,
    })
  }
)
