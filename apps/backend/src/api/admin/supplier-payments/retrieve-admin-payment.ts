import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ACCOUNTING_MODULE } from "../../../modules/accounting"
import type AccountingModuleService from "../../../modules/accounting/service"
import { mapPayment } from "./map-payment"
import type { AdminPayment, PaymentExtras, PaymentRow } from "./map-payment"

// Reads suppliers and invoices for a set of payments in one query each.
export const loadPaymentExtras = async (
  scope: MedusaContainer,
  rows: PaymentRow[]
): Promise<Map<string, PaymentExtras>> => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))]
  const invoiceIds = [...new Set(rows.map((row) => row.invoice_id))]

  const suppliers = new Map<string, { id: string; name: string }>()
  if (supplierIds.length) {
    const { data } = await query.graph({
      entity: "supplier",
      fields: ["id", "name"],
      filters: { id: supplierIds },
      // take: null reads every row (typed as number only).
      pagination: { take: null as unknown as undefined },
    })
    for (const s of data as unknown as { id: string; name: string }[]) {
      suppliers.set(s.id, { id: s.id, name: s.name })
    }
  }

  const invoices = new Map<
    string,
    { id: string; display_id: number; invoice_number: string }
  >()
  if (invoiceIds.length) {
    const { data } = await query.graph({
      entity: "invoice",
      fields: ["id", "display_id", "invoice_number"],
      filters: { id: invoiceIds },
      pagination: { take: null as unknown as undefined },
    })
    for (const i of data as unknown as {
      id: string
      display_id: number
      invoice_number: string
    }[]) {
      invoices.set(i.id, i)
    }
  }

  return new Map(
    rows.map((row) => [
      row.id,
      {
        supplier: suppliers.get(row.supplier_id) ?? null,
        invoice: invoices.get(row.invoice_id) ?? null,
      },
    ])
  )
}

// Reads one payment in the AdminPayment shape.
export const retrieveAdminPayment = async (
  scope: MedusaContainer,
  id: string
): Promise<AdminPayment> => {
  // A bad id throws NOT_FOUND (404). Read through the accounting service:
  // query.graph looks for a listSupplierPayments method that does not exist.
  const row = (await scope
    .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    .retrievePayment(id)) as unknown as PaymentRow
  const extras = await loadPaymentExtras(scope, [row])
  return mapPayment(row, extras.get(row.id) as PaymentExtras)
}
