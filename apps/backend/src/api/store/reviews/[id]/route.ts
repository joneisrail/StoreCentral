import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import deleteReviewWorkflow from "../../../../workflows/delete-review"

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  await deleteReviewWorkflow(req.scope).run({
    input: { reviewId: req.params.id, customerId: req.auth_context.actor_id },
  })
  return res.status(204).send()
}
