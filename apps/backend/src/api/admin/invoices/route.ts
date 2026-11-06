import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { createInvoiceWorkflow } from "../../../workflows/create-invoice"
import type { CreateInvoiceSchema } from "./middlewares"
import { retrieveAdminInvoice } from "./retrieve-admin-invoice"

export async function POST(
  req: AuthenticatedMedusaRequest<CreateInvoiceSchema>,
  res: MedusaResponse
) {
  const { result } = await createInvoiceWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  const invoice = await retrieveAdminInvoice(req.scope, result.invoice.id)

  res.json({ invoice })
}
