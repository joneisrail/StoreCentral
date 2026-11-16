import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  ensureChannelOffersStep,
  type EnsureChannelOffersInput,
} from "./steps/ensure-channel-offers"

export const ensureChannelOffersWorkflow = createWorkflow(
  "ensure-channel-offers",
  function (input: EnsureChannelOffersInput) {
    return new WorkflowResponse(ensureChannelOffersStep(input))
  }
)

export default ensureChannelOffersWorkflow
