import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import { invoiceStatusLockKey } from "../../modules/accounting/utils"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import { purchaseLockKey } from "../../modules/purchase/utils"
import {
  restoreInvoiceStatus,
  snapshotInvoiceStatus,
} from "./invoice-status-restore"

export type PostInvoiceStepInput = { id: string }

// Posts a draft invoice. The status check and the write run under the
// invoice's status lock, so a concurrent post or void cannot interleave.
export const postInvoiceStep = createStep(
  "post-invoice",
  async (input: PostInvoiceStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const purchases = container.resolve<PurchaseModuleService>(PURCHASE_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    const previous = await locking.execute(
      [invoiceStatusLockKey(input.id)],
      async () => {
        // A bad id throws NOT_FOUND (404).
        const existing = await accounting.retrieveInvoice(input.id, {
          relations: ["items"],
        })
        if (existing.status !== "draft") {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Invoice ${existing.invoice_number} is ${existing.status}; only a draft invoice can be posted`
          )
        }
        if (!existing.items.length) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Invoice ${existing.invoice_number} has no lines and cannot be posted`
          )
        }

        // Lock order: invoice status lock (held here) FIRST, purchase lock
        // SECOND. Cancelling a purchase takes only the purchase lock, so no
        // path takes the purchase lock and then an invoice status lock.
        return await locking.execute(
          [purchaseLockKey(existing.purchase_id)],
          async () => {
            const purchase = await purchases.retrievePurchase(
              existing.purchase_id
            )
            if (
              purchase.status === "cancelled" ||
              purchase.status === "draft"
            ) {
              throw new MedusaError(
                MedusaError.Types.NOT_ALLOWED,
                `Invoice ${existing.invoice_number} cannot be posted: its purchase is ${purchase.status}`
              )
            }

            const snapshot = snapshotInvoiceStatus(existing)
            await accounting.updateInvoices({
              id: existing.id,
              status: "posted",
              posted_at: new Date(),
            } as never)
            return snapshot
          }
        )
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
      .execute([invoiceStatusLockKey(previous.id)], () =>
        restoreInvoiceStatus(
          container.resolve<AccountingModuleService>(ACCOUNTING_MODULE),
          previous
        )
      )
  }
)
