import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  adjustInventoryLevelsStep,
  createInventoryLevelsStep,
  createRemoteLinkStep,
} from "@medusajs/medusa/core-flows"
import { recordPurchaseReceiptStep } from "./steps/record-purchase-receipt"
import { validatePurchaseReceiptStep } from "./steps/validate-purchase-receipt"

export type ReceivePurchaseGoodsWorkflowInput = {
  purchase_id: string
  stock_location_id: string
  items: { purchase_item_id: string; quantity: number }[]
  note?: string
}

export const receivePurchaseGoodsWorkflow = createWorkflow(
  "receive-purchase-goods",
  function (input: ReceivePurchaseGoodsWorkflowInput) {
    // Read-only: nothing is written unless the whole request is valid.
    const validation = validatePurchaseReceiptStep({
      purchase_id: input.purchase_id,
      stock_location_id: input.stock_location_id,
      items: input.items,
    })

    when(
      { validation },
      ({ validation }) => validation.missingLevels.length > 0
    ).then(() => {
      createInventoryLevelsStep(validation.missingLevels)
    })

    const recorded = recordPurchaseReceiptStep({
      purchase_id: input.purchase_id,
      stock_location_id: input.stock_location_id,
      items: input.items,
      note: input.note,
    })

    const links = transform({ recorded }, ({ recorded }) => {
      const definitions: LinkDefinition[] = [
        {
          purchase: { purchase_receipt_id: recorded.receipt.id },
          [Modules.STOCK_LOCATION]: {
            stock_location_id: recorded.receipt.stock_location_id,
          },
        },
      ]
      return definitions
    })
    createRemoteLinkStep(links)

    // Last, so a failure anywhere before it leaves stock untouched.
    adjustInventoryLevelsStep(validation.adjustments)

    return new WorkflowResponse({
      purchase: recorded.purchase,
      receipt: recorded.receipt,
    })
  }
)

export default receivePurchaseGoodsWorkflow
