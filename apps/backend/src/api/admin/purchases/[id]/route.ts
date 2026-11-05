import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { updatePurchaseWorkflow } from "../../../../workflows/update-purchase"
import { mapPurchaseForAdmin, PURCHASE_FIELDS } from "../map-purchase"
import type { PurchaseRow } from "../map-purchase"
import type { UpdatePurchaseSchema } from "../middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "purchase",
    fields: PURCHASE_FIELDS,
    filters: { id: req.params.id },
  })

  if (!data.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Purchase with id: ${req.params.id} was not found`
    )
  }

  const row = data[0] as unknown as PurchaseRow & {
    supplier?: { id: string; name: string } | null
  }

  res.json({ purchase: mapPurchaseForAdmin(row, row.supplier ?? null) })
}

export async function POST(
  req: MedusaRequest<UpdatePurchaseSchema>,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  await updatePurchaseWorkflow(req.scope).run({
    input: { purchase_id: req.params.id, ...req.validatedBody },
  })

  const { data } = await query.graph({
    entity: "purchase",
    fields: PURCHASE_FIELDS,
    filters: { id: req.params.id },
  })
  const row = data[0] as unknown as PurchaseRow & {
    supplier?: { id: string; name: string } | null
  }

  res.json({ purchase: mapPurchaseForAdmin(row, row.supplier ?? null) })
}
