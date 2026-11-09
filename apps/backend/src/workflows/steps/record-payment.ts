import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import {
  calculateBalance,
  calculateInvoiceTotals,
  invoiceStatusLockKey,
  isValidPaymentAmount,
  toCents,
} from "../../modules/accounting/utils"

export type RecordPaymentStepInput = {
  invoice_id: string
  amount: number
  paid_at: string
  method: "bank_transfer" | "cash" | "card" | "cheque" | "other"
  reference?: string | null
  note?: string | null
}

const money = (cents: number): string => (cents / 100).toFixed(2)

// Records a payment against a posted invoice. The status check, the balance
// check (in whole cents) and the insert all run under the invoice's status
// lock, so two payments cannot both fit the same remaining balance.
export const recordPaymentStep = createStep(
  "record-payment",
  async (input: RecordPaymentStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    if (!isValidPaymentAmount(input.amount)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Amount must be greater than zero with at most 2 decimal places"
      )
    }
    const amount = Math.round(input.amount * 100) / 100

    const created = await locking.execute(
      [invoiceStatusLockKey(input.invoice_id)],
      async () => {
        // A bad id throws NOT_FOUND (404).
        const invoice = await accounting.retrieveInvoice(input.invoice_id, {
          relations: ["items"],
        })
        if (invoice.status !== "posted") {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Invoice ${invoice.invoice_number} is ${invoice.status}; only a posted invoice can be paid`
          )
        }

        const { total } = calculateInvoiceTotals(
          invoice.items.map((item) => ({
            quantity: Number(item.quantity),
            unit_cost: Number(item.unit_cost),
          })),
          {
            shipping_cost: Number(invoice.shipping_cost),
            tax: Number(invoice.tax),
            other_cost: Number(invoice.other_cost),
          }
        )
        // take: null reads every payment of the invoice, not one page.
        const existing = await accounting.listPayments(
          { invoice_id: invoice.id },
          { take: null }
        )
        const balance = calculateBalance(
          total,
          existing.map((p) => ({ amount: Number(p.amount), status: p.status }))
        )
        if (toCents(amount) > toCents(balance)) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Amount ${money(toCents(amount))} exceeds the invoice balance ${money(toCents(balance))}`
          )
        }

        return accounting.createPayments({
          invoice_id: invoice.id,
          supplier_id: invoice.supplier_id,
          amount,
          paid_at: new Date(input.paid_at),
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
        } as never)
      }
    )

    return new StepResponse({ id: created.id }, created.id)
  },
  async (paymentId, { container }) => {
    if (!paymentId) {
      return
    }
    await container
      .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
      .deletePayments(paymentId)
  }
)
