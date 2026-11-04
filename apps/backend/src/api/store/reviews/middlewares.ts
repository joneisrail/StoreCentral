import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const CreateReviewSchema = z.object({
  product_id: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(1),
  comment: z.string().min(1),
})
export type CreateReviewSchema = z.infer<typeof CreateReviewSchema>

export const reviewMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/reviews",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateReviewSchema)],
  },
]
