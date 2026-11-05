import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import type { ResolvedPurchaseItem } from "./resolve-purchase-items"

export type CreatePurchaseStepInput = {
  items: ResolvedPurchaseItem[]
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
}

export const createPurchaseStep = createStep(
  "create-purchase",
  async (input: CreatePurchaseStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)

    const purchase = await purchaseModule.createPurchases({
      shipping_cost: input.shipping_cost ?? 0,
      tax: input.tax ?? 0,
      other_cost: input.other_cost ?? 0,
      notes: input.notes,
      // The generated DTO types hasMany relations as string[]; nested create
      // of plain objects is supported at runtime and keeps the write atomic.
      items: input.items as never,
    })

    const created = await purchaseModule.listPurchaseItems(
      { purchase_id: purchase.id },
      { select: ["id", "variant_id"] }
    )

    return new StepResponse(
      { id: purchase.id, items: created },
      { id: purchase.id, item_ids: created.map((i) => i.id) }
    )
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)
    await purchaseModule.deletePurchaseItems(previous.item_ids)
    await purchaseModule.deletePurchases(previous.id)
  }
)
