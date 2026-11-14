import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { markOrderShippedWorkflow } from "../../../../../workflows/mark-order-shipped"
import type { MarkShippedSchema } from "../../middlewares"

// Held, canceled, shipped and label-holding orders are NOT_ALLOWED MedusaErrors
// (400); an unknown order is NOT_FOUND (404). Neither the body nor the tracking
// number is logged.
export async function POST(req: AuthenticatedMedusaRequest<MarkShippedSchema>, res: MedusaResponse) {
  const { result } = await markOrderShippedWorkflow(req.scope).run({
    input: { ...req.validatedBody, order_id: req.params.id, user_id: req.auth_context?.actor_id },
  })
  res.status(200).json({ order_id: result.order_id, fulfillment_id: result.fulfillment_id })
}
