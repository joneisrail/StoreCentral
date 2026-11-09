import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import { invoiceStatusLockKey } from "../../modules/accounting/utils"

export type VoidPaymentStepInput = { id: string }

type PaymentSnapshot = { id: string; status: string; voided_at: Date | null }

// Voids a recorded payment, freeing its amount on the invoice. The check and
// the write run under the invoice's status lock, the same lock that guards
// recording, so a void and a payment cannot interleave.
export const voidPaymentStep = createStep(
  "void-payment",
  async (input: VoidPaymentStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    // Finds the invoice to lock; a bad id throws NOT_FOUND (404).
    const found = await accounting.retrievePayment(input.id)

    const previous = await locking.execute(
      [invoiceStatusLockKey(found.invoice_id)],
      async (): Promise<PaymentSnapshot> => {
        const existing = await accounting.retrievePayment(input.id)
        if (existing.status === "void") {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Payment is already void"
          )
        }
        const snapshot: PaymentSnapshot = {
          id: existing.id,
          status: existing.status,
          voided_at: existing.voided_at ? new Date(existing.voided_at) : null,
        }
        await accounting.updatePayments({
          id: existing.id,
          status: "void",
          voided_at: new Date(),
        } as never)
        return snapshot
      }
    )

    return new StepResponse(
      { id: previous.id },
      { ...previous, invoice_id: found.invoice_id }
    )
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }
    await container
      .resolve(Modules.LOCKING)
      .execute([invoiceStatusLockKey(previous.invoice_id)], () =>
        container
          .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
          .updatePayments({
            id: previous.id,
            status: previous.status,
            voided_at: previous.voided_at,
          } as never)
      )
  }
)
