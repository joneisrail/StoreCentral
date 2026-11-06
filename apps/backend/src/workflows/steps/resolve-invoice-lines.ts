import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type InvoiceLineInput = {
  supplier_sku?: string
  variant_id?: string
  remember_code?: boolean
  purchase_item_id?: string
  quantity: number
  unit_cost: number
  description?: string
}

export type ResolveInvoiceLinesStepInput = {
  purchase_id: string
  items: InvoiceLineInput[]
}

export type ResolvedInvoiceLine = {
  variant_id: string
  supplier_sku: string
  description: string
  purchase_item_id: string | null
  quantity: number
  unit_cost: number
  // Set when the line's code should be added to the supplier's list.
  remember_code: boolean
}

export type ResolvedInvoiceLines = {
  supplier: { id: string; name: string }
  purchase: { id: string; status: string }
  items: ResolvedInvoiceLine[]
}

type PurchaseItemRow = { id: string; variant_id: string; title: string }
type SupplierProductRow = {
  variant_id: string
  supplier_sku: string
  supplier_sku_key: string
  supplier_title: string | null
}

const invalid = (message: string) =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message)

const codeKey = (code: string) => code.trim().toLowerCase()

// Picks the purchase item a line belongs to: the named one (which must be on
// this purchase and carry the line's variant), else the only item with the
// variant, else none. Two items with the variant need an explicit choice.
const matchPurchaseItem = (
  items: PurchaseItemRow[],
  variantId: string,
  requestedId: string | undefined
): PurchaseItemRow | null => {
  if (requestedId) {
    const named = items.find((item) => item.id === requestedId)
    if (!named) {
      throw invalid(
        `Purchase item ${requestedId} does not belong to this purchase`
      )
    }
    if (named.variant_id !== variantId) {
      throw invalid(
        `Purchase item ${requestedId} is for a different product than this line`
      )
    }
    return named
  }

  const candidates = items.filter((item) => item.variant_id === variantId)
  if (candidates.length > 1) {
    throw invalid(
      `The purchase has ${candidates.length} items for ${candidates[0].title}; specify purchase_item_id`
    )
  }
  return candidates[0] ?? null
}

// Read-only: loads the purchase (and its supplier through the link) and the
// supplier's product list, then resolves every line to a variant, a supplier
// code snapshot, a description and its purchase item. Nothing is written.
export const resolveInvoiceLinesStep = createStep(
  "resolve-invoice-lines",
  async (input: ResolveInvoiceLinesStepInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: purchases } = await query.graph({
      entity: "purchase",
      fields: [
        "id",
        "status",
        "items.id",
        "items.variant_id",
        "items.title",
        "supplier.id",
        "supplier.name",
      ],
      filters: { id: input.purchase_id },
    })
    if (!purchases.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Purchase with id: ${input.purchase_id} was not found`
      )
    }
    const purchase = purchases[0] as unknown as {
      id: string
      status: string
      items: PurchaseItemRow[]
      supplier?: { id: string; name: string } | null
    }
    const supplier = purchase.supplier
    if (!supplier) {
      throw invalid(`Purchase ${purchase.id} has no supplier`)
    }

    // The supplier's list entries this request can refer to, by code and by
    // variant.
    const keys = [
      ...new Set(
        input.items
          .filter((line) => line.supplier_sku)
          .map((line) => codeKey(line.supplier_sku!))
      ),
    ]
    const pickedVariantIds = [
      ...new Set(
        input.items
          .filter((line) => line.variant_id)
          .map((line) => line.variant_id!)
      ),
    ]
    const listed: SupplierProductRow[] = []
    const fields = [
      "variant_id",
      "supplier_sku",
      "supplier_sku_key",
      "supplier_title",
    ]
    if (keys.length) {
      const { data } = await query.graph({
        entity: "supplier_product",
        fields,
        filters: { supplier_id: supplier.id, supplier_sku_key: keys },
      })
      listed.push(...(data as unknown as SupplierProductRow[]))
    }
    if (pickedVariantIds.length) {
      const { data } = await query.graph({
        entity: "supplier_product",
        fields,
        filters: { supplier_id: supplier.id, variant_id: pickedVariantIds },
      })
      listed.push(...(data as unknown as SupplierProductRow[]))
    }
    const byKey = new Map(listed.map((row) => [row.supplier_sku_key, row]))
    const byVariant = new Map(listed.map((row) => [row.variant_id, row]))

    // Codes being remembered in this request count as known for other lines.
    const remembered = new Map<string, string>()
    for (const line of input.items) {
      if (line.remember_code && line.supplier_sku && line.variant_id) {
        remembered.set(codeKey(line.supplier_sku), line.variant_id)
      }
    }

    const lines = input.items.map((line) => {
      const code = line.supplier_sku?.trim()
      const entry = code ? byKey.get(codeKey(code)) : undefined

      let variantId = line.variant_id
      if (!variantId) {
        variantId = entry?.variant_id ?? remembered.get(codeKey(code!))
        if (!variantId) {
          throw invalid(
            `Supplier code "${code}" is not on ${supplier.name}'s product list`
          )
        }
      } else if (
        code &&
        entry &&
        entry.variant_id !== variantId &&
        // Remembering reports a taken code with the supplier list's own
        // message (remember step).
        !line.remember_code
      ) {
        throw invalid(
          `Supplier code "${code}" is listed for a different product on ${supplier.name}'s product list`
        )
      }

      const listedEntry = entry ?? byVariant.get(variantId)
      return {
        line,
        variant_id: variantId,
        supplier_sku: entry?.supplier_sku ?? code ?? listedEntry?.supplier_sku ?? "",
        supplier_title: listedEntry?.supplier_title ?? null,
      }
    })

    const variantIds = [...new Set(lines.map((line) => line.variant_id))]
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "title"],
      filters: { id: variantIds },
    })
    const variantTitle = new Map(
      (variants as { id: string; title: string | null }[]).map((v) => [
        v.id,
        v.title ?? "",
      ])
    )
    const missing = variantIds.filter((id) => !variantTitle.has(id))
    if (missing.length) {
      throw invalid(`Product variants were not found: ${missing.join(", ")}`)
    }

    const items: ResolvedInvoiceLine[] = lines.map((resolved) => {
      const match = matchPurchaseItem(
        purchase.items ?? [],
        resolved.variant_id,
        resolved.line.purchase_item_id
      )
      return {
        variant_id: resolved.variant_id,
        supplier_sku: resolved.supplier_sku,
        description:
          resolved.line.description?.trim() ||
          match?.title ||
          resolved.supplier_title ||
          variantTitle.get(resolved.variant_id)!,
        purchase_item_id: match?.id ?? null,
        quantity: resolved.line.quantity,
        unit_cost: resolved.line.unit_cost,
        remember_code: !!resolved.line.remember_code,
      }
    })

    const result: ResolvedInvoiceLines = {
      supplier: { id: supplier.id, name: supplier.name },
      purchase: { id: purchase.id, status: purchase.status },
      items,
    }
    return new StepResponse(result)
  }
)
