import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { createPurchaseStep } from "./steps/create-purchase"
import { resolvePurchaseItemsStep } from "./steps/resolve-purchase-items"

export type CreatePurchaseWorkflowInput = {
  supplier_id: string
  items: { variant_id: string; quantity: number; unit_cost: number }[]
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
}

export const createPurchaseWorkflow = createWorkflow(
  "create-purchase",
  function (input: CreatePurchaseWorkflowInput) {
    const items = resolvePurchaseItemsStep({
      supplier_id: input.supplier_id,
      items: input.items,
    })

    const purchase = createPurchaseStep(
      transform({ input, items }, ({ input, items }) => ({
        items,
        shipping_cost: input.shipping_cost,
        tax: input.tax,
        other_cost: input.other_cost,
        notes: input.notes,
      }))
    )

    const links = transform({ input, purchase }, ({ input, purchase }) => {
      const definitions: LinkDefinition[] = [
        {
          purchase: { purchase_id: purchase.id },
          supplier: { supplier_id: input.supplier_id },
        },
        ...purchase.items.map(
          (item): LinkDefinition => ({
            purchase: { purchase_item_id: item.id },
            [Modules.PRODUCT]: { product_variant_id: item.variant_id },
          })
        ),
      ]
      return definitions
    })

    createRemoteLinkStep(links)

    return new WorkflowResponse({ purchase })
  }
)

export default createPurchaseWorkflow
