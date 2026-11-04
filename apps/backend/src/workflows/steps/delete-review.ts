import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
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

export const validateReviewOwnershipStep = createStep(
  "validate-review-ownership",
  async (
    input: { reviewId: string; customerId: string },
    { container }
  ) => {
    const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)

    // Let NOT_FOUND propagate untouched for a bad id -- this must 404, not
    // 400, so we never catch it here.
    const review: Review = await reviewModule.retrieveReview(input.reviewId)

    if (review.customer_id !== input.customerId) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "You can only delete your own review."
      )
    }

    return new StepResponse(review)
  }
)

export const deleteReviewRowStep = createStep(
  "delete-review-row",
  async (review: Review, { container }) => {
    const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)

    await reviewModule.deleteReviews(review.id)

    // Compensation intentionally omitted -- a deleted review is not restored
    // on workflow failure after this point, an accepted limitation for a
    // delete operation.
    return new StepResponse({ id: review.id }, review.id)
  }
)
