import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  markOrderShippedStep,
  resolveMarkShippedPlacementStep,
  validateMarkOrderShippedStep,
} from "./steps/mark-order-shipped-steps"

export type MarkOrderShippedWorkflowInput = {
  order_id: string
  carrier: string
  tracking_number: string
  tracking_url?: string
  shipped_at?: string
  no_notification?: boolean
  location_id?: string
  user_id?: string
}

export const markOrderShippedWorkflow = createWorkflow(
  "mark-order-shipped",
  function (input: MarkOrderShippedWorkflowInput) {
    // Serializes concurrent mark-shipped calls for one order; a second call fails
    // fast (timeout 0). The acquire step's compensation releases the lock when
    // anything below fails, the release step does so on success.
    acquireLockStep({ key: input.order_id, timeout: 0, ttl: 60 })
    const state = validateMarkOrderShippedStep({ order_id: input.order_id })
    const placement = resolveMarkShippedPlacementStep({
      order_id: input.order_id,
      location_id: input.location_id,
    })
    const stepInput = transform({ input, state, placement }, ({ input, state, placement }) => ({
      order_id: input.order_id,
      items: state.items,
      location_id: placement.location_id,
      shipping_option_id: placement.shipping_option_id,
      carrier: input.carrier,
      tracking_number: input.tracking_number,
      tracking_url: input.tracking_url,
      shipped_at: input.shipped_at,
      no_notification: input.no_notification,
      user_id: input.user_id,
    }))
    const result = markOrderShippedStep(stepInput)
    releaseLockStep({ key: input.order_id })
    return new WorkflowResponse(result)
  }
)

export default markOrderShippedWorkflow
