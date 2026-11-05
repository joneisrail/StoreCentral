import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { placePurchaseOrderStep } from "./steps/place-purchase-order"

export type PlacePurchaseOrderWorkflowInput = {
  purchase_id: string
}

export const placePurchaseOrderWorkflow = createWorkflow(
  "place-purchase-order",
  function (input: PlacePurchaseOrderWorkflowInput) {
    const purchase = placePurchaseOrderStep({ purchase_id: input.purchase_id })

    return new WorkflowResponse({ purchase })
  }
)

export default placePurchaseOrderWorkflow
