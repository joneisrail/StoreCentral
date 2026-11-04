import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { updateReviewStatusStep } from "./steps/update-review-status"

type UpdateReviewStatusInput = {
  reviewId: string
  status: "approved" | "rejected"
}

const updateReviewStatusWorkflow = createWorkflow(
  "update-review-status",
  function (input: UpdateReviewStatusInput) {
    const review = updateReviewStatusStep(input)

    return new WorkflowResponse({ review })
  }
)

export default updateReviewStatusWorkflow
