import {
  createWorkflow,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import { checkVerifiedPurchaseStep } from "./steps/check-verified-purchase"
import { upsertReviewStep } from "./steps/upsert-review"

type UpsertReviewInput = {
  product_id: string
  customer_id: string
  rating: number
  title: string
  comment: string
}

const upsertReviewWorkflow = createWorkflow(
  "upsert-review",
  function (input: UpsertReviewInput) {
    const orderId = checkVerifiedPurchaseStep({
      customerId: input.customer_id,
      productId: input.product_id,
    })
    const result = upsertReviewStep(
      transform({ input, orderId }, (data) => ({ ...data.input, orderId: data.orderId }))
    )

    const linkData = transform({ result }, ({ result }): LinkDefinition[] => [
      {
        review: { review_id: result.review.id },
        [Modules.PRODUCT]: { product_id: result.review.product_id },
      },
      {
        review: { review_id: result.review.id },
        [Modules.CUSTOMER]: { customer_id: result.review.customer_id },
      },
    ])

    when(result, (result) => result.wasCreated).then(function () {
      createRemoteLinkStep(linkData)
    })

    return new WorkflowResponse({ review: result.review })
  }
)

export default upsertReviewWorkflow
