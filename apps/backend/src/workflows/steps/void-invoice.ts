import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import { invoiceStatusLockKey } from "../../modules/accounting/utils"
import {
  restoreInvoiceStatus,
  snapshotInvoiceStatus,
} from "./invoice-status-restore"

export type VoidInvoiceStepInput = { id: string }

// Voids a draft or posted invoice (which frees its number). The status check
// and the write run under the invoice's status lock.
export const voidInvoiceStep = createStep(
  "void-invoice",
  async (input: VoidInvoiceStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    const previous = await locking.execute(
      [invoiceStatusLockKey(input.id)],
      async () => {
        // A bad id throws NOT_FOUND (404).
        const existing = await accounting.retrieveInvoice(input.id)
        if (existing.status === "void") {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Invoice ${existing.invoice_number} is already void`
          )
        }

        // A live payment blocks the void. This runs under the same status lock
        // as record-payment, so a payment and a void cannot both succeed.
        const live = await accounting.listPayments(
          { invoice_id: existing.id, status: "recorded" },
          { take: null }
        )
        if (live.length) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Invoice ${existing.invoice_number} has ${live.length} payment(s); void the payments first`
          )
        }

        const snapshot = snapshotInvoiceStatus(existing)
        await accounting.updateInvoices({
          id: existing.id,
          status: "void",
          voided_at: new Date(),
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
      .execute([invoiceStatusLockKey(previous.id)], () =>
        restoreInvoiceStatus(
          container.resolve<AccountingModuleService>(ACCOUNTING_MODULE),
          previous
        )
      )
  }
)
