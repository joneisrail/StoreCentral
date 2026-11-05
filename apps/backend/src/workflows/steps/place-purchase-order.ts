import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"

export type PlacePurchaseOrderStepInput = {
  purchase_id: string
}

type PreviousState = {
  id: string
  status: string
  ordered_at: Date | null
}

const restore = async (
  purchaseModule: PurchaseModuleService,
  previous: PreviousState
) => {
  await purchaseModule.updatePurchases({
    id: previous.id,
    status: previous.status,
    ordered_at: previous.ordered_at,
  } as never)
}

export const placePurchaseOrderStep = createStep(
  "place-purchase-order",
  async (input: PlacePurchaseOrderStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)

    // A bad id throws NOT_FOUND here (404) before any write is attempted.
    const existing = await purchaseModule.retrievePurchase(input.purchase_id, {
      relations: ["items"],
    })
    if (existing.status !== "draft") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Only a draft purchase can be ordered, this one is ${existing.status}`
      )
    }
    if (!existing.items.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "A purchase without items cannot be ordered"
      )
    }

    const previous: PreviousState = {
      id: existing.id,
      status: existing.status,
      ordered_at: existing.ordered_at ? new Date(existing.ordered_at) : null,
    }

    await purchaseModule.updatePurchases({
      id: existing.id,
      status: "ordered",
      ordered_at: new Date(),
    } as never)

    return new StepResponse({ id: existing.id }, previous)
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    await restore(
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE),
      previous
    )
  }
)
