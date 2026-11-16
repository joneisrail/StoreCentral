import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  trimChannelStockStep,
  type TrimChannelStockInput,
} from "./steps/trim-channel-stock"
import { CHANNEL_OFFER_CHANGED_EVENT } from "./update-channel-offer"

export const trimChannelStockWorkflow = createWorkflow(
  "trim-channel-stock",
  function (input: TrimChannelStockInput) {
    const trimmed = trimChannelStockStep(input)
    // One event per trimmed channel; an empty list emits nothing.
    emitEventStep({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: transform({ trimmed }, ({ trimmed }) =>
        trimmed.changed.map((c) => ({
          variant_id: c.variant_id,
          sales_channel_id: c.sales_channel_id,
          kind: "stock",
          manual: false,
        }))
      ),
    })
    return new WorkflowResponse(trimmed)
  }
)

export default trimChannelStockWorkflow
