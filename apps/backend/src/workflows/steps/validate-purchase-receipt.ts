import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import { validateReceiveQuantities } from "../../modules/purchase/utils"

export type ValidatePurchaseReceiptStepInput = {
  purchase_id: string
  stock_location_id: string
  items: { purchase_item_id: string; quantity: number }[]
}

export type ValidatePurchaseReceiptStepOutput = {
  adjustments: {
    inventory_item_id: string
    location_id: string
    adjustment: number
  }[]
  missingLevels: {
    inventory_item_id: string
    location_id: string
    stocked_quantity: 0
  }[]
}

const RECEIVABLE_STATUSES = ["ordered", "partially_received"]

export const assertPurchaseReceivable = (status: string) => {
  if (!RECEIVABLE_STATUSES.includes(status)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Cannot receive goods on a ${status} purchase`
    )
  }
}

type VariantRow = {
  id: string
  manage_inventory: boolean
  inventory_items?: {
    inventory_item_id: string
    required_quantity?: number | null
  }[]
}

// Read-only: checks everything the receipt needs and computes the stock
// changes, so nothing is written when a request is invalid. The quantity
// check here is only an early answer; the authoritative one runs again
// inside the purchase lock in recordPurchaseReceiptStep.
export const validatePurchaseReceiptStep = createStep(
  "validate-purchase-receipt",
  async (input: ValidatePurchaseReceiptStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)

    // Unknown ids throw NOT_FOUND (404).
    const purchase = await purchaseModule.retrievePurchase(input.purchase_id, {
      relations: ["items"],
    })
    assertPurchaseReceivable(purchase.status)
    validateReceiveQuantities(purchase.items, input.items)

    await container
      .resolve(Modules.STOCK_LOCATION)
      .retrieveStockLocation(input.stock_location_id)

    const lines = input.items.map((line) => ({
      ...line,
      item: purchase.items.find((i) => i.id === line.purchase_item_id)!,
    }))

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "manage_inventory",
        "inventory_items.inventory_item_id",
        "inventory_items.required_quantity",
      ],
      filters: { id: [...new Set(lines.map((l) => l.item.variant_id))] },
    })
    const variants = data as unknown as VariantRow[]

    // One adjustment per inventory item, summed when several lines (or a
    // multi-part variant) touch the same item.
    const totals = new Map<string, number>()
    for (const { item, quantity } of lines) {
      const variant = variants.find((v) => v.id === item.variant_id)
      if (!variant) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Cannot receive ${item.title}: its variant no longer exists`
        )
      }
      if (!variant.manage_inventory) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Cannot receive ${item.title}: its variant does not manage inventory`
        )
      }
      const inventoryItems = (variant.inventory_items ?? []).filter(
        (link) => !!link?.inventory_item_id
      )
      if (!inventoryItems.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Cannot receive ${item.title}: its variant has no inventory item`
        )
      }
      for (const link of inventoryItems) {
        const units = quantity * Number(link.required_quantity ?? 1)
        totals.set(
          link.inventory_item_id,
          (totals.get(link.inventory_item_id) ?? 0) + units
        )
      }
    }

    const inventoryItemIds = [...totals.keys()]
    const levels = await container
      .resolve(Modules.INVENTORY)
      .listInventoryLevels(
        {
          inventory_item_id: inventoryItemIds,
          location_id: input.stock_location_id,
        },
        { select: ["id", "inventory_item_id"] }
      )
    const stocked = new Set(levels.map((level) => level.inventory_item_id))

    const output: ValidatePurchaseReceiptStepOutput = {
      adjustments: inventoryItemIds.map((inventoryItemId) => ({
        inventory_item_id: inventoryItemId,
        location_id: input.stock_location_id,
        adjustment: totals.get(inventoryItemId)!,
      })),
      missingLevels: inventoryItemIds
        .filter((inventoryItemId) => !stocked.has(inventoryItemId))
        .map((inventoryItemId) => ({
          inventory_item_id: inventoryItemId,
          location_id: input.stock_location_id,
          stocked_quantity: 0 as const,
        })),
    }

    return new StepResponse(output)
  }
)
