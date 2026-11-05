import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createRemoteLinkStep,
  dismissRemoteLinkStep,
} from "@medusajs/medusa/core-flows"
import { loadDraftPurchaseStep } from "./steps/load-draft-purchase"
import { resolvePurchaseItemsStep } from "./steps/resolve-purchase-items"
import { updatePurchaseStep } from "./steps/update-purchase"

export type UpdatePurchaseWorkflowInput = {
  purchase_id: string
  items?: { variant_id: string; quantity: number; unit_cost: number }[]
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
}

export const updatePurchaseWorkflow = createWorkflow(
  "update-purchase",
  function (input: UpdatePurchaseWorkflowInput) {
    // Validate everything (draft status, unknown variants) before any write.
    const current = loadDraftPurchaseStep({ purchase_id: input.purchase_id })

    const resolved = when({ input }, ({ input }) => !!input.items).then(() =>
      resolvePurchaseItemsStep(
        transform({ input, current }, ({ input, current }) => ({
          supplier_id: current.supplier_id,
          items: input.items!,
        }))
      )
    )

    const purchase = updatePurchaseStep(
      transform({ input, resolved }, ({ input, resolved }) => ({
        purchase_id: input.purchase_id,
        items: resolved ?? undefined,
        shipping_cost: input.shipping_cost,
        tax: input.tax,
        other_cost: input.other_cost,
        notes: input.notes,
      }))
    )

    when({ input }, ({ input }) => !!input.items).then(() => {
      dismissRemoteLinkStep(
        transform({ current }, ({ current }) =>
          current.items.map((item): LinkDefinition => ({
            purchase: { purchase_item_id: item.id },
            [Modules.PRODUCT]: { product_variant_id: item.variant_id },
          }))
        )
      )

      createRemoteLinkStep(
        transform({ purchase }, ({ purchase }) =>
          (purchase.items ?? []).map((item): LinkDefinition => ({
            purchase: { purchase_item_id: item.id },
            [Modules.PRODUCT]: { product_variant_id: item.variant_id },
          }))
        )
      )
    })

    return new WorkflowResponse({ purchase })
  }
)

export default updatePurchaseWorkflow
