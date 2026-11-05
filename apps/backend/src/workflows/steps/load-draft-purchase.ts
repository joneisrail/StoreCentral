import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type LoadDraftPurchaseStepInput = {
  purchase_id: string
}

// Read-only: fails with 404 for an unknown purchase and 400 unless it is a
// draft, so a workflow can validate before it writes. Nothing to undo.
export const loadDraftPurchaseStep = createStep(
  "load-draft-purchase",
  async (input: LoadDraftPurchaseStepInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "purchase",
      fields: ["id", "status", "items.id", "items.variant_id", "supplier.id"],
      filters: { id: input.purchase_id },
    })
    const purchase = data[0]
    if (!purchase) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Purchase with id: ${input.purchase_id} was not found`
      )
    }
    if (purchase.status !== "draft") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Only a draft purchase can be edited, this one is ${purchase.status}`
      )
    }

    const supplierId = purchase.supplier?.id
    if (!supplierId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Purchase with id: ${input.purchase_id} has no supplier`
      )
    }

    return new StepResponse({
      supplier_id: supplierId as string,
      items: (purchase.items ?? []).map((item) => ({
        id: item!.id as string,
        variant_id: item!.variant_id as string,
      })),
    })
  }
)
