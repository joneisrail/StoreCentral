import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { mapPayment } from "../supplier-payments/map-payment"
import type { AdminPayment } from "../supplier-payments/map-payment"
import { loadInvoicePayments } from "./invoice-payments"
import { INVOICE_FIELDS, mapInvoice } from "./map-invoice"
import type { AdminInvoice, InvoiceRow } from "./map-invoice"

// Reads one invoice with its purchase (through the link), its supplier (by
// the stored supplier_id) and its payments (newest first). Throws NOT_FOUND
// (404) for an unknown id.
export const retrieveAdminInvoiceDetail = async (
  scope: MedusaContainer,
  id: string
): Promise<{ invoice: AdminInvoice; payments: AdminPayment[] }> => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "invoice",
    fields: INVOICE_FIELDS,
    filters: { id },
  })
  if (!data.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Invoice with id: ${id} was not found`
    )
  }
  const row = data[0] as unknown as InvoiceRow & {
    purchase?: { id: string; display_id: number } | null
  }

  const { data: suppliers } = await query.graph({
    entity: "supplier",
    fields: ["id", "name"],
    filters: { id: row.supplier_id },
  })
  const supplier = suppliers[0] as { id: string; name: string } | undefined

  const payments =
    (await loadInvoicePayments(scope, [row.id])).get(row.id) ?? []
  const supplierRef = supplier ? { id: supplier.id, name: supplier.name } : null

  const invoice = mapInvoice(
    row,
    { supplier: supplierRef, purchase: row.purchase ?? null },
    payments,
    new Date()
  )
  return {
    invoice,
    payments: payments.map((payment) =>
      mapPayment(payment, {
        supplier: supplierRef,
        invoice: {
          id: row.id,
          display_id: row.display_id,
          invoice_number: row.invoice_number,
        },
      })
    ),
  }
}

// The invoice alone, in the AdminInvoice shape.
export const retrieveAdminInvoice = async (
  scope: MedusaContainer,
  id: string
): Promise<AdminInvoice> =>
  (await retrieveAdminInvoiceDetail(scope, id)).invoice

