import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { holdOrderWorkflow } from "../../../../../workflows/hold-order"
import type { HoldOrderSchema } from "../../middlewares"

// Validation errors (canceled, shipped, already held, unknown order) are thrown
// by the workflow as MedusaErrors and mapped to 400/404 by the framework.
export async function POST(req: AuthenticatedMedusaRequest<HoldOrderSchema>, res: MedusaResponse) {
  await holdOrderWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      reason: req.validatedBody.reason,
      user_id: req.auth_context?.actor_id,
    },
  })
  res.status(200).json({ order_id: req.params.id, on_hold: true })
}
