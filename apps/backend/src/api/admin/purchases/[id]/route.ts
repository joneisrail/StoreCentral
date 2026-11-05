import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { mapPurchaseForAdmin, PURCHASE_FIELDS } from "../map-purchase"
import type { PurchaseRow } from "../map-purchase"

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
