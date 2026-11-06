import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type ResolvePurchaseItemsStepInput = {
  supplier_id: string
  items: { variant_id: string; quantity: number; unit_cost: number }[]
  // Only new purchases refuse an inactive supplier; existing drafts keep
  // working after their supplier is deactivated.
  require_active_supplier?: boolean
}

export type ResolvedPurchaseItem = {
  variant_id: string
  sku: string
  title: string
  quantity: number
  unit_cost: number
}

// Read-only: validates the supplier and variants exist and snapshots the
// variant sku and title. Nothing is written, so there is nothing to undo.
export const resolvePurchaseItemsStep = createStep(
  "resolve-purchase-items",
  async (input: ResolvePurchaseItemsStepInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: suppliers } = await query.graph({
      entity: "supplier",
      fields: ["id", "name", "is_active"],
      filters: { id: input.supplier_id },
    })
    if (!suppliers.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Supplier with id: ${input.supplier_id} was not found`
      )
    }

    if (input.require_active_supplier && !suppliers[0].is_active) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Supplier ${suppliers[0].name} is inactive and cannot be used for new purchases`
      )
    }

    const variantIds = [...new Set(input.items.map((i) => i.variant_id))]
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "title"],
      filters: { id: variantIds },
    })

    const byId = new Map(variants.map((v) => [v.id, v]))
    const missing = variantIds.filter((id) => !byId.has(id))
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product variants were not found: ${missing.join(", ")}`
      )
    }

    const items: ResolvedPurchaseItem[] = input.items.map((item) => {
      const variant = byId.get(item.variant_id)!
      return {
        variant_id: item.variant_id,
        sku: variant.sku ?? "",
        title: variant.title ?? "",
        quantity: item.quantity,
        unit_cost: item.unit_cost,
      }
    })

    return new StepResponse(items)
  }
)
