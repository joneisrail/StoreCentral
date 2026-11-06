import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { INVOICE_FIELDS, mapInvoice } from "./map-invoice"
import type { AdminInvoice, InvoiceRow } from "./map-invoice"

// Reads one invoice with its purchase (through the link) and its supplier (by
// the stored supplier_id) in the AdminInvoice shape. Throws NOT_FOUND (404)
// for an unknown id.
export const retrieveAdminInvoice = async (
  scope: MedusaContainer,
  id: string
): Promise<AdminInvoice> => {
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

  return mapInvoice(row, {
    supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
    purchase: row.purchase ?? null,
  })
}
