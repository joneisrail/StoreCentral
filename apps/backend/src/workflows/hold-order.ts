import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  bulkTagOrdersWorkflow,
  createOrderTagsWorkflow,
  updateOrderWorkflow,
} from "@medusajs/medusa/core-flows"
import { findHoldTagStep, HOLD_TAG_VALUE, validateOrderHoldStep } from "./steps/hold-order-steps"

export type HoldOrderWorkflowInput = { order_id: string; reason: string; user_id?: string }

// If the metadata write fails after the tag was attached, the engine rolls the
// tag attachment back through bulkTagOrdersStep's own compensation.
export const holdOrderWorkflow = createWorkflow(
  "hold-order",
  function (input: HoldOrderWorkflowInput) {
    const state = validateOrderHoldStep({ order_id: input.order_id, mode: "hold" })
    // Two concurrent first holds could each create the tag; accepted (admin-only, rare).
    const existing = findHoldTagStep()

    const created = when("hold-tag-missing", { existing }, ({ existing }) => !existing).then(() =>
      createOrderTagsWorkflow.runAsStep({
        input: { order_tags: [{ value: HOLD_TAG_VALUE }] },
      })
    )
    const tagId = transform({ existing, created }, ({ existing, created }) =>
      existing ? existing.id : (created ?? [])[0]?.id
    )

    bulkTagOrdersWorkflow.runAsStep({
      input: transform({ input, tagId }, ({ input, tagId }) => ({
        order_ids: [input.order_id],
        add: [tagId],
      })),
    })

    const update = transform({ input, state }, ({ input, state }) => ({
      id: input.order_id,
      user_id: input.user_id as string,
      metadata: {
        ...state.metadata,
        hold: {
          reason: input.reason,
          held_at: new Date().toISOString(),
          held_by: input.user_id ?? null,
        },
      },
    }))
    updateOrderWorkflow.runAsStep({ input: update })

    return new WorkflowResponse(
      transform({ input, tagId }, ({ input, tagId }) => ({ order_id: input.order_id, tag_id: tagId }))
    )
  }
)

export default holdOrderWorkflow
