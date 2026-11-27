import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { clampLimit, clampOffset, toAverage, toPublicReview } from "./helpers"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const productId = req.params.id
  const limit = clampLimit(req.query.limit)
  const offset = clampOffset(req.query.offset)
  const filters: Record<string, unknown> = {
    product_id: productId,
    status: "approved",
  }

  const { data: page } = await query.graph({
    entity: "review",
    fields: ["id", "rating", "title", "comment", "created_at", "customer.first_name"],
    filters,
    pagination: { take: limit, skip: offset, order: { created_at: "DESC" } },
  })

  const { data: all } = await query.graph({
    entity: "review",
    fields: ["rating"],
    filters,
  })

  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({
    reviews: page.map((r: any) => toPublicReview(r)),
    count: all.length,
    average: toAverage(all.map((r: any) => r.rating)),
    limit,
    offset,
  })
}
