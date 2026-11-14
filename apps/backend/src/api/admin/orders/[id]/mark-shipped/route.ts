import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { markOrderShippedWorkflow } from "../../../../../workflows/mark-order-shipped"
import type { MarkShippedSchema } from "../../middlewares"

// Held, canceled, shipped and label-holding orders are NOT_ALLOWED MedusaErrors
// (400); an unknown order is NOT_FOUND (404). Neither the body nor the tracking
// number is logged.
export async function POST(req: AuthenticatedMedusaRequest<MarkShippedSchema>, res: MedusaResponse) {
  let result
  try {
    ;({ result } = await markOrderShippedWorkflow(req.scope).run({
      input: { ...req.validatedBody, order_id: req.params.id, user_id: req.auth_context?.actor_id },
    }))
  } catch (e) {
    // The per-order lock is held by a concurrent request (core throws a plain Error).
    if (/Failed to acquire lock/.test(String((e as { message?: unknown })?.message ?? ""))) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "This order is already being marked shipped")
    }
    throw e
  }
  res.status(200).json({ order_id: result.order_id, fulfillment_id: result.fulfillment_id })
}
