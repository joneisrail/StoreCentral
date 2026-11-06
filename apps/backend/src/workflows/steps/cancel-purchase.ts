import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import { purchaseLockKey } from "../../modules/purchase/utils"
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
    const locking = container.resolve(Modules.LOCKING)

    // Same lock as receiving goods: a receipt cannot be recorded between the
    // check below and the status write.
    const previous = await locking.execute(
      [purchaseLockKey(input.purchase_id)],
      async () => {
        // A bad id throws NOT_FOUND here (404) before any write is attempted.
        const existing = await purchaseModule.retrievePurchase(
          input.purchase_id,
          { relations: ["items"] }
        )
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

        const snapshot = snapshotPurchaseStatus(existing)

        // ordered_at is kept as history.
        await purchaseModule.updatePurchases({
          id: existing.id,
          status: "cancelled",
        } as never)

        return snapshot
      }
    )

    return new StepResponse({ id: previous.id }, previous)
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    await container
      .resolve(Modules.LOCKING)
      .execute([purchaseLockKey(previous.id)], async () => {
        await restorePurchaseStatus(
          container.resolve<PurchaseModuleService>(PURCHASE_MODULE),
          previous
        )
      })
  }
)
