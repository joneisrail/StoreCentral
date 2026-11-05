import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import {
  restorePurchaseStatus,
  snapshotPurchaseStatus,
} from "./purchase-status-restore"

export type CancelPurchaseStepInput = {
  purchase_id: string
}

export const cancelPurchaseStep = createStep(
  "cancel-purchase",
  async (input: CancelPurchaseStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)

    // A bad id throws NOT_FOUND here (404) before any write is attempted.
    const existing = await purchaseModule.retrievePurchase(input.purchase_id, {
      relations: ["items"],
    })
    if (existing.status !== "draft" && existing.status !== "ordered") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `A ${existing.status} purchase cannot be cancelled`
      )
    }
    if (existing.items.some((item) => item.quantity_received > 0)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "A purchase with received goods cannot be cancelled"
      )
    }

    const previous = snapshotPurchaseStatus(existing)

    // ordered_at is kept as history.
    await purchaseModule.updatePurchases({
      id: existing.id,
      status: "cancelled",
    } as never)

    return new StepResponse({ id: existing.id }, previous)
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    await restorePurchaseStatus(
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE),
      previous
    )
  }
)
