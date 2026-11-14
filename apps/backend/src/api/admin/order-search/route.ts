import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { OrderSearchQuerySchema } from "./middlewares"
import { searchOrders, type QueryLike } from "./search"

// Order ids matching the search (newest first, at most 200). /admin routes are
// authenticated by the framework's default middleware; input is validated by
// the strict query schema. The search text is never logged.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const params = req.validatedQuery as unknown as OrderSearchQuerySchema
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
  res.json(await searchOrders(query, params))
}
