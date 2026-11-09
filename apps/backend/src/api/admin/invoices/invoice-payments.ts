import type { MedusaContainer } from "@medusajs/framework/types"
import { ACCOUNTING_MODULE } from "../../../modules/accounting"
import type AccountingModuleService from "../../../modules/accounting/service"
import type { PaymentRow } from "../supplier-payments/map-payment"

// Reads the payments of every given invoice in ONE query (never one per
// invoice), newest first. Payments are read through the accounting service
// because query.graph cannot read them and no link exists. take: null reads
// every payment, not the service's default page.
export const loadInvoicePayments = async (
  scope: MedusaContainer,
  invoiceIds: string[]
): Promise<Map<string, PaymentRow[]>> => {
  const byInvoice = new Map<string, PaymentRow[]>()
  if (!invoiceIds.length) {
    return byInvoice
  }
  const rows = (await scope
    .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    .listPayments(
      { invoice_id: invoiceIds },
      { take: null, order: { created_at: "DESC", id: "DESC" } }
    )) as unknown as PaymentRow[]
  for (const row of rows) {
    const list = byInvoice.get(row.invoice_id) ?? []
    list.push(row)
    byInvoice.set(row.invoice_id, list)
  }
  return byInvoice
}
