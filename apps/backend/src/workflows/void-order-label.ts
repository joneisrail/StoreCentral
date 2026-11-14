import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { validateVoidOrderLabelStep, voidOrderLabelFulfillmentsStep } from "./steps/void-order-label-steps"

export type VoidOrderLabelWorkflowInput = { order_id: string; user_id?: string }

export const voidOrderLabelWorkflow = createWorkflow(
  "void-order-label",
  function (input: VoidOrderLabelWorkflowInput) {
    const state = validateVoidOrderLabelStep({ order_id: input.order_id })
    const voided = voidOrderLabelFulfillmentsStep(state)
    return new WorkflowResponse(
      transform({ input, voided }, ({ input, voided }) => ({ order_id: input.order_id, voided }))
    )
  }
)

export default voidOrderLabelWorkflow
