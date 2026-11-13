import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createSalesChannelsWorkflow } from "@medusajs/medusa/core-flows"
import { linkSalesChannelStockAndProductsStep } from "./steps/link-sales-channel-stock-and-products"

export type CreateMarketplaceSalesChannelWorkflowInput = {
  name: string
  description?: string
  is_disabled?: boolean
}

export const createMarketplaceSalesChannelWorkflow = createWorkflow(
  "create-marketplace-sales-channel",
  function (input: CreateMarketplaceSalesChannelWorkflowInput) {
    const channels = createSalesChannelsWorkflow.runAsStep({
      input: {
        salesChannelsData: transform({ input }, ({ input }) => [
          {
            name: input.name,
            description: input.description,
            is_disabled: input.is_disabled,
          },
        ]),
      },
    })
    const channel = transform({ channels }, ({ channels }) => ({
      id: channels[0].id,
      name: channels[0].name,
    }))
    linkSalesChannelStockAndProductsStep(channel)
    return new WorkflowResponse(channel)
  }
)

export default createMarketplaceSalesChannelWorkflow
