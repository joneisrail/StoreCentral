import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import type { ResolvedPurchaseItem } from "./resolve-purchase-items"

export type UpdatePurchaseStepInput = {
  purchase_id: string
  // When given, replaces every existing item.
  items?: ResolvedPurchaseItem[]
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
}

type PreviousState = {
  id: string
  shipping_cost: number
  tax: number
  other_cost: number
  notes: string | null
  // The items that were replaced, or null when items were not touched.
  replaced_items:
    | {
        id: string
        purchase_id: string
        variant_id: string
        sku: string
        title: string
        quantity: number
        quantity_received: number
        unit_cost: number
      }[]
    | null
  created_item_ids: string[]
}

const restore = async (
  purchaseModule: PurchaseModuleService,
  previous: PreviousState
) => {
  await purchaseModule.updatePurchases({
    id: previous.id,
    shipping_cost: previous.shipping_cost,
    tax: previous.tax,
    other_cost: previous.other_cost,
    notes: previous.notes,
  })

  if (!previous.replaced_items) {
    return
  }

  if (previous.created_item_ids.length) {
    await purchaseModule.deletePurchaseItems(previous.created_item_ids)
  }

  // Recreate the old items under their original ids (so the restored
  // item-variant links still match), skipping any that were never deleted.
  const remaining = await purchaseModule.listPurchaseItems(
    { purchase_id: previous.id },
    { select: ["id"] }
  )
  const present = new Set(remaining.map((item) => item.id))
  const missing = previous.replaced_items.filter(
    (item) => !present.has(item.id)
  )
  if (missing.length) {
    await purchaseModule.createPurchaseItems(missing)
  }
}

export const updatePurchaseStep = createStep(
  "update-purchase",
  async (input: UpdatePurchaseStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)

    // A bad id throws NOT_FOUND here (404) before any write is attempted.
    const existing = await purchaseModule.retrievePurchase(input.purchase_id, {
      relations: ["items"],
    })
    // Residual race: an ordered transition committed between this check and
    // the writes below is not detected. Accepted: the plan scopes locking to
    // receive-goods.
    if (existing.status !== "draft") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Only a draft purchase can be edited, this one is ${existing.status}`
      )
    }

    const previous: PreviousState = {
      id: existing.id,
      shipping_cost: Number(existing.shipping_cost),
      tax: Number(existing.tax),
      other_cost: Number(existing.other_cost),
      notes: existing.notes,
      replaced_items: input.items
        ? existing.items.map((item) => ({
            id: item.id,
            purchase_id: existing.id,
            variant_id: item.variant_id,
            sku: item.sku,
            title: item.title,
            quantity: item.quantity,
            quantity_received: item.quantity_received,
            unit_cost: Number(item.unit_cost),
          }))
        : null,
      created_item_ids: [],
    }

    const changes: Record<string, unknown> = { id: existing.id }
    for (const key of [
      "shipping_cost",
      "tax",
      "other_cost",
      "notes",
    ] as const) {
      if (input[key] !== undefined) {
        changes[key] = input[key]
      }
    }

    let items: { id: string; variant_id: string }[] | null = null
    try {
      if (input.items) {
        const created = await purchaseModule.createPurchaseItems(
          input.items.map((item) => ({
            purchase_id: existing.id,
            variant_id: item.variant_id,
            sku: item.sku,
            title: item.title,
            quantity: item.quantity,
            unit_cost: item.unit_cost,
          }))
        )
        previous.created_item_ids = created.map((item) => item.id)
        items = created.map((item) => ({
          id: item.id,
          variant_id: item.variant_id,
        }))
      }

      await purchaseModule.updatePurchases(changes as never)

      if (input.items) {
        await purchaseModule.deletePurchaseItems(
          existing.items.map((item) => item.id)
        )
      }
    } catch (error) {
      // Compensation only runs for completed steps, so undo a partial write.
      await restore(purchaseModule, previous)
      throw error
    }

    return new StepResponse({ id: existing.id, items }, previous)
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
