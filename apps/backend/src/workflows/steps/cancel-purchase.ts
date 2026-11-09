import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import { formatInvoiceReference } from "../../modules/accounting/utils"
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
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Lock order: this step takes only the purchase lock. Posting an invoice
    // takes the invoice status lock first and the purchase lock second.
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

        // take: null reads every row (typed as number only).
        const all = null as unknown as undefined
        const { data: blocking } = await query.graph({
          entity: "invoice",
          fields: ["id", "display_id", "invoice_number", "status"],
          filters: {
            purchase_id: input.purchase_id,
            status: ["draft", "posted"],
          },
          pagination: { take: all, order: { display_id: "ASC" } },
        })
        if (blocking.length) {
          const first = blocking[0] as unknown as {
            display_id: number
            invoice_number: string
            status: string
          }
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Purchase cannot be cancelled: invoice ${formatInvoiceReference(first.display_id)} (${first.invoice_number}) is ${first.status}`
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
