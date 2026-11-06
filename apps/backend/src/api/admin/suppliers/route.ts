import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { escapeLike } from "../../../modules/supplier/utils"
import { createSupplierWorkflow } from "../../../workflows/create-supplier"
import { SUPPLIER_FIELDS } from "./fields"
import type {
  CreateSupplierSchema,
  ListSuppliersQuerySchema,
} from "./middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { q, is_active, limit, offset } =
    req.validatedQuery as unknown as ListSuppliersQuerySchema

  const filters: Record<string, unknown> = {}
  if (q?.trim()) {
    filters.name = { $ilike: `%${escapeLike(q)}%` }
  }
  if (is_active) {
    filters.is_active = is_active === "true"
  }

  const { data, metadata } = await query.graph({
    entity: "supplier",
    fields: SUPPLIER_FIELDS,
    filters,
    pagination: { take: limit, skip: offset, order: { created_at: "DESC" } },
  })

  res.json({
    suppliers: data,
    count: metadata?.count ?? data.length,
    offset,
    limit,
  })
}

export async function POST(
  req: MedusaRequest<CreateSupplierSchema>,
  res: MedusaResponse
) {
  const { result } = await createSupplierWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  res.json({ supplier: result.supplier })
}
