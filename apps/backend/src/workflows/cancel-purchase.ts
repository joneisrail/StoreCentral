import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { cancelPurchaseStep } from "./steps/cancel-purchase"

export type CancelPurchaseWorkflowInput = {
  purchase_id: string
}

export const cancelPurchaseWorkflow = createWorkflow(
  "cancel-purchase",
  function (input: CancelPurchaseWorkflowInput) {
    const purchase = cancelPurchaseStep({ purchase_id: input.purchase_id })

    return new WorkflowResponse({ purchase })
  }
)

export default cancelPurchaseWorkflow
