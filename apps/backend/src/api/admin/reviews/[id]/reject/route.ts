import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import updateReviewStatusWorkflow from "../../../../../workflows/update-review-status"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { result } = await updateReviewStatusWorkflow(req.scope).run({
    input: { reviewId: req.params.id, status: "rejected" },
  })
  return res.json({ review: result.review })
}
