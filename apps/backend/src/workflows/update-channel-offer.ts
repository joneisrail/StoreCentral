import {
  createWorkflow,
  transform,
  when,
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
    validateChannelOfferEditStep(input)
    const applied = applyChannelOfferEditStep(input)

    // Only a real change is announced. Staged by Medusa and released once the
    // whole workflow succeeded, so emission cannot undo the committed edit.
    when({ applied }, ({ applied }) => applied.kind !== null).then(() => {
      emitEventStep({
        eventName: CHANNEL_OFFER_CHANGED_EVENT,
        data: transform({ input, applied }, ({ input, applied }) => ({
          variant_id: input.variant_id,
          sales_channel_id: input.channel_id,
          kind: applied.kind,
          manual: true,
        })),
      })
    })

    return new WorkflowResponse(
      transform({ input, applied }, ({ input, applied }) => ({
        variant_id: input.variant_id,
        sales_channel_id: input.channel_id,
        kind: applied.kind,
        offer: applied.offer,
      }))
    )
  }
)

export default updateChannelOfferWorkflow
