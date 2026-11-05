import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { placePurchaseOrderWorkflow } from "../../../../../workflows/place-purchase-order"
import { retrieveAdminPurchase } from "../../retrieve-admin-purchase"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await placePurchaseOrderWorkflow(req.scope).run({
    input: { purchase_id: req.params.id },
  })

  res.json({ purchase: await retrieveAdminPurchase(req.scope, req.params.id) })
}
