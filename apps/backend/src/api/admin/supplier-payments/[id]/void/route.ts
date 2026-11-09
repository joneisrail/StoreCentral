import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { voidPaymentWorkflow } from "../../../../../workflows/void-payment"
import { retrieveAdminPayment } from "../../retrieve-admin-payment"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await voidPaymentWorkflow(req.scope).run({ input: { id: req.params.id } })

  res.json({ payment: await retrieveAdminPayment(req.scope, req.params.id) })
}
