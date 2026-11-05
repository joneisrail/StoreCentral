import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPurchaseWorkflow } from "../../../workflows/create-purchase"
import { mapPurchaseForAdmin, PURCHASE_FIELDS } from "./map-purchase"
import type { PurchaseRow } from "./map-purchase"
import type {
  CreatePurchaseSchema,
  ListPurchasesQuerySchema,
} from "./middlewares"

type PurchaseWithSupplier = PurchaseRow & {
  supplier?: { id: string; name: string } | null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { status, supplier_id, limit, offset } =
    req.validatedQuery as unknown as ListPurchasesQuerySchema

  const filters: Record<string, unknown> = {}
  if (status) {
    filters.status = status
  }

  if (supplier_id) {
    // query.graph cannot filter on a linked field, so read the purchase ids
    // from the supplier side and filter on those.
    const { data: suppliers } = await query.graph({
      entity: "supplier",
      fields: ["id", "purchases.id"],
      filters: { id: supplier_id },
    })
    const purchaseIds = (suppliers[0]?.purchases ?? []).map(
      (p) => p!.id
    )
    if (!purchaseIds.length) {
      return res.json({ purchases: [], count: 0, offset, limit })
    }
    filters.id = { $in: purchaseIds }
  }

  const { data, metadata } = await query.graph({
    entity: "purchase",
    fields: PURCHASE_FIELDS,
    filters,
    pagination: { take: limit, skip: offset, order: { display_id: "DESC" } },
  })

  const purchases = (data as unknown as PurchaseWithSupplier[]).map((row) =>
    mapPurchaseForAdmin(row, row.supplier ?? null)
  )

  res.json({
    purchases,
    count: metadata?.count ?? purchases.length,
    offset,
    limit,
  })
}

export async function POST(
  req: MedusaRequest<CreatePurchaseSchema>,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { result } = await createPurchaseWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  const { data } = await query.graph({
    entity: "purchase",
    fields: PURCHASE_FIELDS,
    filters: { id: result.purchase.id },
  })
  const row = data[0] as unknown as PurchaseWithSupplier

  res.json({ purchase: mapPurchaseForAdmin(row, row.supplier ?? null) })
}
