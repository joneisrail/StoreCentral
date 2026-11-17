import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  validateChannelSyncRequestStep,
  type ChannelSyncInput,
} from "./steps/validate-channel-sync-request"
import { CHANNEL_OFFER_CHANGED_EVENT } from "./update-channel-offer"

export type RequestChannelSyncInput = ChannelSyncInput

// The sync icon: asks seller-hub to push the channel's price and stock now,
// regardless of the connection's auto_sync_price (force: true).
export const requestChannelSyncWorkflow = createWorkflow(
  "request-channel-sync",
  function (input: RequestChannelSyncInput) {
    validateChannelSyncRequestStep(input)
    emitEventStep({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: transform({ input }, ({ input }) => ({
        variant_id: input.variant_id,
        sales_channel_id: input.channel_id,
        kind: "both",
        force: true,
      })),
    })
    return new WorkflowResponse(transform({ input }, () => ({ queued: true })))
  }
)

export default requestChannelSyncWorkflow
