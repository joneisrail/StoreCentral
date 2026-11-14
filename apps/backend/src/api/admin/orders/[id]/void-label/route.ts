import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { voidOrderLabelWorkflow } from "../../../../../workflows/void-order-label"
import type { VoidOrderLabelSchema } from "../../middlewares"

// Nothing-to-void, shipped and carrier-refund failures are MedusaErrors thrown
// by the workflow and mapped to 400/404 by the framework.
export async function POST(req: AuthenticatedMedusaRequest<VoidOrderLabelSchema>, res: MedusaResponse) {
  const { result } = await voidOrderLabelWorkflow(req.scope).run({
    input: { order_id: req.params.id, user_id: req.auth_context?.actor_id },
  })
  res.status(200).json(result)
}
