import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import upsertReviewWorkflow from "../../../workflows/upsert-review"
import { CreateReviewSchema } from "./middlewares"

export async function POST(
  req: AuthenticatedMedusaRequest<CreateReviewSchema>,
  res: MedusaResponse
) {
  const { result } = await upsertReviewWorkflow(req.scope).run({
    input: {
      product_id: req.validatedBody.product_id,
      customer_id: req.auth_context.actor_id,
      rating: req.validatedBody.rating,
      title: req.validatedBody.title,
      comment: req.validatedBody.comment,
    },
  })
  return res.json({ review: result.review })
}
