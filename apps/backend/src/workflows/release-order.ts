import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { bulkTagOrdersWorkflow, updateOrderWorkflow } from "@medusajs/medusa/core-flows"
import { recordOrderEventStep } from "./steps/record-order-event"
import { validateOrderHoldStep } from "./steps/hold-order-steps"

export type ReleaseOrderWorkflowInput = { order_id: string; user_id?: string }

export const releaseOrderWorkflow = createWorkflow(
  "release-order",
  function (input: ReleaseOrderWorkflowInput) {
    const state = validateOrderHoldStep({ order_id: input.order_id, mode: "release" })

    bulkTagOrdersWorkflow.runAsStep({
      input: transform({ state }, ({ state }) => ({
        order_ids: [state.order_id],
        remove: state.hold_tag_ids,
      })),
    })

    // Order metadata is merged on update and an empty string removes the key.
    updateOrderWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({
        id: input.order_id,
        user_id: input.user_id as string,
        metadata: { hold: "" },
      })),
    })

    recordOrderEventStep(
      transform({ input, state }, ({ input, state }) => {
        const hold = state.metadata?.hold as { reason?: unknown } | undefined
        return {
          order_id: input.order_id,
          type: "order.released" as const,
          actor: input.user_id,
          old_value: { reason: typeof hold?.reason === "string" ? hold.reason : null },
        }
      })
    )

    return new WorkflowResponse(transform({ input }, ({ input }) => ({ order_id: input.order_id })))
  }
)

export default releaseOrderWorkflow
