import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { postInvoiceWorkflow } from "../../../../../workflows/post-invoice"
import { retrieveAdminInvoice } from "../../retrieve-admin-invoice"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await postInvoiceWorkflow(req.scope).run({ input: { id: req.params.id } })

  res.json({ invoice: await retrieveAdminInvoice(req.scope, req.params.id) })
}
