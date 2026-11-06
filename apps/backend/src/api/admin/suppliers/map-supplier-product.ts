import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const SUPPLIER_PRODUCT_FIELDS = [
  "id",
  "supplier_id",
  "variant_id",
  "supplier_sku",
  "supplier_title",
  "unit_cost",
  "notes",
  "created_at",
  "product_variant.id",
  "product_variant.title",
  "product_variant.sku",
  "product_variant.product.id",
  "product_variant.product.title",
]

export type SupplierProductRow = {
  id: string
  supplier_id: string
  variant_id: string
  supplier_sku: string
  supplier_title: string | null
  unit_cost: number | string | null
  notes: string | null
  product_variant?: {
    id: string
    title: string | null
    sku: string | null
    product?: { id: string; title: string } | null
  } | null
}

export type AdminSupplierProduct = {
  id: string
  supplier_id: string
  variant_id: string
  supplier_sku: string
  supplier_title: string | null
  unit_cost: number | null
  notes: string | null
  variant: {
    id: string
    title: string | null
    sku: string | null
    product: { id: string; title: string } | null
  } | null
}

// The variant is null once it has been deleted from the catalog.
export const mapSupplierProduct = (
  row: SupplierProductRow
): AdminSupplierProduct => {
  const variant = row.product_variant
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    variant_id: row.variant_id,
    supplier_sku: row.supplier_sku,
    supplier_title: row.supplier_title,
    unit_cost: row.unit_cost === null ? null : Number(row.unit_cost),
    notes: row.notes,
    variant: variant
      ? {
          id: variant.id,
          title: variant.title,
          sku: variant.sku,
          product: variant.product
            ? { id: variant.product.id, title: variant.product.title }
            : null,
        }
      : null,
  }
}

// Reads one entry (just written by a workflow) in the admin shape.
export const retrieveAdminSupplierProduct = async (
  scope: MedusaContainer,
  id: string
): Promise<AdminSupplierProduct> => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "supplier_product",
    fields: SUPPLIER_PRODUCT_FIELDS,
    filters: { id },
  })

  return mapSupplierProduct(data[0] as unknown as SupplierProductRow)
}
