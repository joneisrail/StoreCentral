import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retrieveAdminPayment } from "../retrieve-admin-payment"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ payment: await retrieveAdminPayment(req.scope, req.params.id) })
}
