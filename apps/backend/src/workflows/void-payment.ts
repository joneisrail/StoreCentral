import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { voidPaymentStep } from "./steps/void-payment"

export type VoidPaymentWorkflowInput = { id: string }

export const voidPaymentWorkflow = createWorkflow(
  "void-payment",
  function (input: VoidPaymentWorkflowInput) {
    const payment = voidPaymentStep({ id: input.id })
    return new WorkflowResponse({ payment })
  }
)

export default voidPaymentWorkflow
