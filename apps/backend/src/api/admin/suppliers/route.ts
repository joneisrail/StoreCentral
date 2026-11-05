import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createSupplierWorkflow } from "../../../workflows/create-supplier"
import type { CreateSupplierSchema } from "./middlewares"

const DEFAULT_LIMIT = 20

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const offset = Number(req.query.offset ?? 0)
  const limit = Number(req.query.limit ?? DEFAULT_LIMIT)
  const q = req.query.q as string | undefined

  const filters: Record<string, unknown> = {}
  if (q) {
    filters.name = { $ilike: `%${q}%` }
  }

  const { data, metadata } = await query.graph({
    entity: "supplier",
    fields: ["id", "name", "email", "phone", "address", "notes", "created_at"],
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
