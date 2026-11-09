import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  recordPaymentStep,
  type RecordPaymentStepInput,
} from "./steps/record-payment"

export type RecordPaymentWorkflowInput = RecordPaymentStepInput

export const recordPaymentWorkflow = createWorkflow(
  "record-payment",
  function (input: RecordPaymentWorkflowInput) {
    const payment = recordPaymentStep(input)
    return new WorkflowResponse({ payment })
  }
)

export default recordPaymentWorkflow
