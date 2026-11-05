import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updatePurchaseWorkflow } from "../../../../workflows/update-purchase"
import { retrieveAdminPurchase } from "../retrieve-admin-purchase"
import type { UpdatePurchaseSchema } from "../middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ purchase: await retrieveAdminPurchase(req.scope, req.params.id) })
}

export async function POST(
  req: MedusaRequest<UpdatePurchaseSchema>,
  res: MedusaResponse
) {
  await updatePurchaseWorkflow(req.scope).run({
    input: { purchase_id: req.params.id, ...req.validatedBody },
  })

  res.json({ purchase: await retrieveAdminPurchase(req.scope, req.params.id) })
}
