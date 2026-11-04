import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { mapReviewForAdminList } from "./map-review"

const DEFAULT_LIMIT = 20

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const offset = Number(req.query.offset ?? 0)
  const limit = Number(req.query.limit ?? DEFAULT_LIMIT)
  const status = req.query.status as string | undefined
  const productId = req.query.product_id as string | undefined

  const filters: Record<string, unknown> = {}
  if (status) {
    filters.status = status
  }
  if (productId) {
    filters.product_id = productId
  }

  const { data, metadata } = await query.graph({
    entity: "review",
    fields: [
      "id",
      "rating",
      "title",
      "comment",
      "status",
      "created_at",
      "product.id",
      "product.title",
      "customer.id",
      "customer.email",
    ],
    filters,
    pagination: { take: limit, skip: offset },
  })

  res.json({
    reviews: data.map(mapReviewForAdminList),
    count: metadata?.count ?? data.length,
    offset,
    limit,
  })
}
