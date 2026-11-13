import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { releaseOrderWorkflow } from "../../../../../workflows/release-order"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await releaseOrderWorkflow(req.scope).run({
    input: { order_id: req.params.id, user_id: req.auth_context?.actor_id },
  })
  res.status(200).json({ order_id: req.params.id, on_hold: false })
}
