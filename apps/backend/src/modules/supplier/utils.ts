import { MedusaError } from "@medusajs/framework/utils"

// Escapes LIKE/ILIKE wildcards so user input matches literally.
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// Trims a supplier's product code and derives its case-insensitive unique key.
export function normalizeSupplierSku(raw: string): {
  supplier_sku: string
  supplier_sku_key: string
} {
  const supplier_sku = (raw ?? "").trim()
  if (!supplier_sku) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Supplier code is required"
    )
  }
  return { supplier_sku, supplier_sku_key: supplier_sku.toLowerCase() }
}
