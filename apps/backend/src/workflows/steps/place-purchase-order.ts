import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import {
  restorePurchaseStatus,
  snapshotPurchaseStatus,
} from "./purchase-status-restore"

export type PlacePurchaseOrderStepInput = {
  purchase_id: string
}

export const placePurchaseOrderStep = createStep(
  "place-purchase-order",
  async (input: PlacePurchaseOrderStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)

    // A bad id throws NOT_FOUND here (404) before any write is attempted.
    const existing = await purchaseModule.retrievePurchase(input.purchase_id, {
      relations: ["items"],
    })
    if (existing.status !== "draft") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Only a draft purchase can be ordered, this one is ${existing.status}`
      )
    }
    if (!existing.items.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "A purchase without items cannot be ordered"
      )
    }

    const previous = snapshotPurchaseStatus(existing)

    await purchaseModule.updatePurchases({
      id: existing.id,
      status: "ordered",
      ordered_at: new Date(),
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
