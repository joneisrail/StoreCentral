import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelPurchaseWorkflow } from "../../../../../workflows/cancel-purchase"
import { retrieveAdminPurchase } from "../../retrieve-admin-purchase"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await cancelPurchaseWorkflow(req.scope).run({
    input: { purchase_id: req.params.id },
  })

  res.json({ purchase: await retrieveAdminPurchase(req.scope, req.params.id) })
}
