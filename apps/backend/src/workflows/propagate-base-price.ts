import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { findDriftedBasePriceOffersStep } from "./steps/find-drifted-base-price-offers"
import { markOffersPendingStep } from "./steps/mark-offers-pending"
import { CHANNEL_OFFER_CHANGED_EVENT } from "./update-channel-offer"

export type PropagateBasePriceInput = { variant_id: string }

// A variant's base price changed: every connected channel that follows the
// base price (no own price) and has drifted from its last pushed price is
// marked pending and announced as a price change. force: false keeps the
// connection's auto_sync_price in charge. An empty drift list emits nothing
// (emitEventStep maps an array to one message per element and returns early
// when there are none).
export const propagateBasePriceWorkflow = createWorkflow(
  "propagate-base-price",
  function (input: PropagateBasePriceInput) {
    const findDrifted = findDriftedBasePriceOffersStep(input)
    markOffersPendingStep(findDrifted)
    emitEventStep({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: transform({ findDrifted }, ({ findDrifted }) =>
        findDrifted.drifted.map((d) => ({
          variant_id: findDrifted.variant_id,
          sales_channel_id: d.channel_id,
          kind: "price",
          force: false,
        }))
      ),
    })
    return new WorkflowResponse(
      transform({ findDrifted }, ({ findDrifted }) => ({
        variant_id: findDrifted.variant_id,
        channels: findDrifted.drifted.map((d) => d.channel_id),
      }))
    )
  }
)

export default propagateBasePriceWorkflow
