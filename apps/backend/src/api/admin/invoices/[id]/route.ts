import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { retrieveAdminPurchase } from "../../purchases/retrieve-admin-purchase"
import { compareInvoice } from "../compare-invoice"
import { retrieveAdminInvoice } from "../retrieve-admin-invoice"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const invoice = await retrieveAdminInvoice(req.scope, req.params.id)
  if (!invoice.purchase) {
    return res.json({ invoice, comparison: null })
  }
  const purchase = await retrieveAdminPurchase(req.scope, invoice.purchase.id)

  // Only posted invoices of the same purchase count toward what is already
  // billed; drafts and voids do not.
  const { data: siblings } = await query.graph({
    entity: "invoice",
    fields: ["id", "items.purchase_item_id", "items.quantity"],
    filters: { purchase_id: purchase.id, status: "posted" },
  })
  const other_invoiced = (
    siblings as unknown as {
      id: string
      items: { purchase_item_id: string | null; quantity: number }[]
    }[]
  )
    .filter((row) => row.id !== invoice.id)
    .flatMap((row) => row.items ?? [])
    .filter((item) => item.purchase_item_id)
    .map((item) => ({
      purchase_item_id: item.purchase_item_id as string,
      quantity: item.quantity,
    }))

  const comparison = compareInvoice({
    purchase_items: purchase.items.map((item) => ({
      id: item.id,
      variant_id: item.variant_id,
      title: item.title,
      quantity: item.quantity,
      quantity_received: item.quantity_received,
      unit_cost: item.unit_cost,
    })),
    lines: invoice.items.map((item) => ({
      purchase_item_id: item.purchase_item_id,
      variant_id: item.variant_id,
      description: item.description,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
    })),
    other_invoiced,
    purchase_total: purchase.total,
    invoice_total: invoice.total,
  })

  res.json({ invoice, comparison })
}
