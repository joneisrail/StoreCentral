import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { receivePurchaseGoodsWorkflow } from "../../../../../workflows/receive-purchase-goods"
import type { ReceivePurchaseSchema } from "../../middlewares"
import { retrieveAdminPurchase } from "../../retrieve-admin-purchase"

export async function POST(
  req: MedusaRequest<ReceivePurchaseSchema>,
  res: MedusaResponse
) {
  const { result } = await receivePurchaseGoodsWorkflow(req.scope).run({
    input: { purchase_id: req.params.id, ...req.validatedBody },
  })

  res.json({
    purchase: await retrieveAdminPurchase(req.scope, req.params.id),
    receipt: result.receipt,
  })
}
