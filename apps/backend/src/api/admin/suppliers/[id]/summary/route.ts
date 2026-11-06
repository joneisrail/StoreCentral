import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { summarizePurchases } from "../../summarize-purchases"

type Money = number | string

type SupplierWithPurchases = {
  id: string
  purchases?: ({
    status: string
    shipping_cost: Money
    tax: Money
    other_cost: Money
    items?: {
      quantity: number
      quantity_received: number
      unit_cost: Money
    }[]
  } | null)[]
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "supplier",
    fields: [
      "id",
      "purchases.status",
      "purchases.shipping_cost",
      "purchases.tax",
      "purchases.other_cost",
      "purchases.items.*",
    ],
    filters: { id: req.params.id },
  })

  if (!data.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Supplier with id: ${req.params.id} was not found`
    )
  }

  const supplier = data[0] as unknown as SupplierWithPurchases

  const summary = summarizePurchases(
    (supplier.purchases ?? []).flatMap((purchase) =>
      purchase
        ? [
            {
              status: purchase.status,
              shipping_cost: Number(purchase.shipping_cost),
              tax: Number(purchase.tax),
              other_cost: Number(purchase.other_cost),
              items: (purchase.items ?? []).map((item) => ({
                quantity: item.quantity,
                quantity_received: item.quantity_received,
                unit_cost: Number(item.unit_cost),
              })),
            },
          ]
        : []
    )
  )

  res.json({ summary })
}
