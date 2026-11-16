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
  createRemoteLinkStep,
} from "@medusajs/medusa/core-flows"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { ensureInventoryLevelsStep } from "./steps/ensure-inventory-levels"
import { recordPurchaseReceiptStep } from "./steps/record-purchase-receipt"
import {
  listReceivedVariantLinesStep,
  splitReceivedStockAcrossChannelsStep,
} from "./steps/split-received-stock-across-channels"
import { validatePurchaseReceiptStep } from "./steps/validate-purchase-receipt"
import { CHANNEL_OFFER_CHANGED_EVENT } from "./update-channel-offer"

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
      ensureInventoryLevelsStep(validation.missingLevels)
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
    const adjusted = adjustInventoryLevelsStep(validation.adjustments)

    // After the stock adjustment (it consumes its output, so Medusa cannot run
    // it earlier or in parallel): the received units are split equally across
    // every channel. Expected conditions are skipped; an unexpected error
    // undoes its own writes and fails the workflow, which compensates the
    // receipt and the stock adjustment.
    const receivedLines = listReceivedVariantLinesStep({
      purchase_id: input.purchase_id,
      items: input.items,
    })
    const split = splitReceivedStockAcrossChannelsStep(
      transform({ adjusted, recorded, receivedLines }, ({ recorded, receivedLines }) => ({
        receipt_id: recorded.receipt.id,
        lines: receivedLines,
      }))
    )
    // Staged by Medusa and released once the whole workflow succeeded.
    emitEventStep({
      eventName: CHANNEL_OFFER_CHANGED_EVENT,
      data: transform({ split }, ({ split }) =>
        split.changed.map((c) => ({
          variant_id: c.variant_id,
          sales_channel_id: c.sales_channel_id,
          kind: "stock",
          manual: false,
        }))
      ),
    })

    return new WorkflowResponse({
      purchase: recorded.purchase,
      receipt: recorded.receipt,
    })
  }
)

export default receivePurchaseGoodsWorkflow
