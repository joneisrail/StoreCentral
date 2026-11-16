import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { applyChannelOfferEditStep } from "./steps/apply-channel-offer-edit"
import {
  validateChannelOfferEditStep,
  type ChannelOfferEditInput,
} from "./steps/validate-channel-offer-edit"

export type UpdateChannelOfferInput = ChannelOfferEditInput

export const CHANNEL_OFFER_CHANGED_EVENT = "channel-offer.changed"

export const updateChannelOfferWorkflow = createWorkflow(
  "update-channel-offer",
  function (input: UpdateChannelOfferInput) {
    const validated = validateChannelOfferEditStep(input)
    applyChannelOfferEditStep(input)

    // Staged by Medusa and only released once the whole workflow succeeded, so
    // an emission problem can never undo or fail the committed edit.
    emitEventStep({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: transform({ input, validated }, ({ input, validated }) => ({
        variant_id: input.variant_id,
        sales_channel_id: input.channel_id,
        kind: validated.kind,
        manual: true,
      })),
    })

    return new WorkflowResponse(
      transform({ input, validated }, ({ input, validated }) => ({
        variant_id: input.variant_id,
        sales_channel_id: input.channel_id,
        kind: validated.kind,
      }))
    )
  }
)

export default updateChannelOfferWorkflow
