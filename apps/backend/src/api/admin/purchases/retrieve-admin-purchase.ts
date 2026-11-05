import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { mapPurchaseForAdmin, PURCHASE_FIELDS } from "./map-purchase"
import type { AdminPurchase, PurchaseRow } from "./map-purchase"

// Reads one purchase through the query graph in the AdminPurchase shape.
// Throws NOT_FOUND (404) for an unknown id.
export const retrieveAdminPurchase = async (
  scope: MedusaContainer,
  id: string
): Promise<AdminPurchase> => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "purchase",
    fields: PURCHASE_FIELDS,
    filters: { id },
  })

  if (!data.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Purchase with id: ${id} was not found`
    )
  }

  const row = data[0] as unknown as PurchaseRow & {
    supplier?: { id: string; name: string } | null
  }

  return mapPurchaseForAdmin(row, row.supplier ?? null)
}
