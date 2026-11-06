import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { voidInvoiceWorkflow } from "../../../../../workflows/void-invoice"
import { retrieveAdminInvoice } from "../../retrieve-admin-invoice"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await voidInvoiceWorkflow(req.scope).run({ input: { id: req.params.id } })

  res.json({ invoice: await retrieveAdminInvoice(req.scope, req.params.id) })
}
