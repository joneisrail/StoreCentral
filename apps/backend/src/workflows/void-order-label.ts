import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { recordOrderEventStep } from "./steps/record-order-event"
import { validateVoidOrderLabelStep, voidOrderLabelFulfillmentsStep } from "./steps/void-order-label-steps"

export type VoidOrderLabelWorkflowInput = { order_id: string; user_id?: string }

export const voidOrderLabelWorkflow = createWorkflow(
  "void-order-label",
  function (input: VoidOrderLabelWorkflowInput) {
    const state = validateVoidOrderLabelStep({ order_id: input.order_id })
    const voided = voidOrderLabelFulfillmentsStep(state)
    recordOrderEventStep(
      transform({ input, voided }, ({ input, voided }) => ({
        order_id: input.order_id,
        type: "order.label_voided" as const,
        actor: input.user_id,
        new_value: { fulfillment_ids: voided.map((v) => v.fulfillment_id) },
      }))
    )
    return new WorkflowResponse(
      transform({ input, voided }, ({ input, voided }) => ({ order_id: input.order_id, voided }))
    )
  }
)

export default voidOrderLabelWorkflow
