import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { rankOffers } from "./rank-offers"
import type { SupplierOffersQuerySchema } from "./middlewares"

type VariantRow = { id: string; title: string | null; sku: string | null }
type OfferRow = {
  id: string
  supplier_id: string
  variant_id: string
  supplier_sku: string
  supplier_title: string | null
  unit_cost: number | string | null
}
type SupplierRow = {
  id: string
  name: string
  is_active: boolean
  lead_time_days: number | null
  payment_terms: string | null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { product_id } =
    req.validatedQuery as unknown as SupplierOffersQuerySchema

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: product_id },
  })
  if (!products.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product with id: ${product_id} was not found`
    )
  }

  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "sku"],
    filters: { product_id },
    pagination: { order: { variant_rank: "ASC", created_at: "ASC", id: "ASC" } },
  })
  const variantRows = variants as unknown as VariantRow[]

  let offerRows: OfferRow[] = []
  let suppliers = new Map<string, SupplierRow>()
  if (variantRows.length) {
    const { data: offers } = await query.graph({
      entity: "supplier_product",
      fields: [
        "id",
        "supplier_id",
        "variant_id",
        "supplier_sku",
        "supplier_title",
        "unit_cost",
        "created_at",
      ],
      filters: { variant_id: variantRows.map((v) => v.id) },
      pagination: { order: { created_at: "ASC", id: "ASC" } },
    })
    offerRows = offers as unknown as OfferRow[]

    const supplierIds = [...new Set(offerRows.map((o) => o.supplier_id))]
    if (supplierIds.length) {
      const { data: supplierData } = await query.graph({
        entity: "supplier",
        fields: ["id", "name", "is_active", "lead_time_days", "payment_terms"],
        filters: { id: supplierIds },
      })
      suppliers = new Map(
        (supplierData as unknown as SupplierRow[]).map((s) => [s.id, s])
      )
    }
  }

  res.json({
    variants: variantRows.map((variant) => {
      const entries = offerRows
        .filter((o) => o.variant_id === variant.id && suppliers.has(o.supplier_id))
        .map((o) => {
          const s = suppliers.get(o.supplier_id) as SupplierRow
          return {
            supplier_product_id: o.id,
            supplier: {
              id: s.id,
              name: s.name,
              is_active: s.is_active,
              lead_time_days: s.lead_time_days,
              payment_terms: s.payment_terms,
            },
            supplier_sku: o.supplier_sku,
            supplier_title: o.supplier_title,
            unit_cost: o.unit_cost === null ? null : Number(o.unit_cost),
            is_active: s.is_active,
          }
        })
      return {
        variant_id: variant.id,
        title: variant.title,
        sku: variant.sku,
        offers: rankOffers(entries).map(({ is_active: _a, ...offer }) => offer),
      }
    }),
  })
}
