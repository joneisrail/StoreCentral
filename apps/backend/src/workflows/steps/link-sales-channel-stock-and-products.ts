import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  linkProductsToSalesChannelWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

export type LinkSalesChannelStockAndProductsInput = { id: string }

// Links every stock location and every product to the channel so draft orders
// can be placed against it (same logic as scripts/setup-shopify-channel.ts).
export async function linkStockAndProducts(
  container: MedusaContainer,
  channelId: string
): Promise<{ stock_locations: number; products: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
  })
  let linkedLocations = 0
  for (const location of stockLocations) {
    if (location.sales_channels?.some((sc: any) => sc?.id === channelId)) continue
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [channelId] },
    })
    linkedLocations++
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "sales_channels.id"],
  })
  const productIds = products
    .filter((p: any) => !p.sales_channels?.some((sc: any) => sc?.id === channelId))
    .map((p: any) => p.id)
  if (productIds.length) {
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: channelId, add: productIds },
    })
  }
  return { stock_locations: linkedLocations, products: productIds.length }
}

// No compensation of its own: a failure here fails the workflow, which rolls
// back the created channel. (Seller-hub failures happen after the workflow
// and never lose the channel.)
export const linkSalesChannelStockAndProductsStep = createStep(
  "link-sales-channel-stock-and-products",
  async (input: LinkSalesChannelStockAndProductsInput, { container }) =>
    new StepResponse(await linkStockAndProducts(container as MedusaContainer, input.id))
)
