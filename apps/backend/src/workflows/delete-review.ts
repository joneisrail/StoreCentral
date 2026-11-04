import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { dismissRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  validateReviewOwnershipStep,
  deleteReviewRowStep,
} from "./steps/delete-review"

type DeleteReviewInput = {
  reviewId: string
  customerId: string
}

const deleteReviewWorkflow = createWorkflow(
  "delete-review",
  function (input: DeleteReviewInput) {
    const review = validateReviewOwnershipStep(input)

    const linkData = transform({ review }, ({ review }): LinkDefinition[] => [
      {
        review: { review_id: review.id },
        [Modules.PRODUCT]: { product_id: review.product_id },
      },
      {
        review: { review_id: review.id },
        [Modules.CUSTOMER]: { customer_id: review.customer_id },
      },
    ])

    dismissRemoteLinkStep(linkData)
    deleteReviewRowStep(review)

    return new WorkflowResponse({ success: true })
  }
)

export default deleteReviewWorkflow
