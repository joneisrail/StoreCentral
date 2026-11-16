import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  applyOrderToChannelStockStep,
  type ApplyOrderToChannelStockInput,
} from "./steps/apply-order-to-channel-stock"
import { CHANNEL_OFFER_CHANGED_EVENT } from "./update-channel-offer"

export type ApplyOrderToChannelStockWorkflowInput = ApplyOrderToChannelStockInput

export const applyOrderToChannelStockWorkflow = createWorkflow(
  "apply-order-to-channel-stock",
  function (input: ApplyOrderToChannelStockWorkflowInput) {
    const applied = applyOrderToChannelStockStep(input)

    // One event per channel whose stock changed; an empty list emits nothing.
    // Staged by Medusa and released once the whole workflow succeeded.
    emitEventStep({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: transform({ applied }, ({ applied }) =>
        applied.changed.map((c) => ({
          variant_id: c.variant_id,
          sales_channel_id: c.sales_channel_id,
          kind: "stock",
          manual: false,
        }))
      ),
    })

    return new WorkflowResponse(applied)
  }
)

export default applyOrderToChannelStockWorkflow
