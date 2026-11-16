import { createWorkflow, createStep, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { SHARE_STOCK_METADATA_KEY } from "../modules/channel-offers/settings"

export type UpdateChannelStockSettingsInput = { share_stock_after_sale: boolean }

const loadStoreStep = createStep("load-store-for-channel-stock-settings", async (_: void, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "store", fields: ["id", "metadata"] })
  const store = data[0] as any
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Store not found")
  return new StepResponse({ id: store.id as string, metadata: (store.metadata ?? {}) as Record<string, unknown> })
})

// Existing metadata keys are merged explicitly so unrelated settings survive.
export const updateChannelStockSettingsWorkflow = createWorkflow(
  "update-channel-stock-settings",
  function (input: UpdateChannelStockSettingsInput) {
    const store = loadStoreStep()
    updateStoresWorkflow.runAsStep({
      input: transform({ input, store }, ({ input, store }) => ({
        selector: { id: store.id },
        update: {
          metadata: { ...store.metadata, [SHARE_STOCK_METADATA_KEY]: input.share_stock_after_sale },
        },
      })),
    })
    return new WorkflowResponse(
      transform({ input }, ({ input }) => ({ share_stock_after_sale: input.share_stock_after_sale }))
    )
  }
)

export default updateChannelStockSettingsWorkflow
