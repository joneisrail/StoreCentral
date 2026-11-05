import { MathBN, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type EnsureInventoryLevelsStepInput = {
  inventory_item_id: string
  location_id: string
  stocked_quantity: 0
}[]

// Same keys as the core adjust-inventory-levels step, so a level is never
// created or removed while stock on it is being adjusted.
const lockKeys = (inventoryItemIds: string[]) => [...new Set(inventoryItemIds)]

// Creates the inventory levels that are still missing. The list passed in may
// be stale (another receive can create a level in between), so levels are
// re-listed under the lock and only the ones this step creates are recorded.
export const ensureInventoryLevelsStep = createStep(
  "ensure-inventory-levels",
  async (input: EnsureInventoryLevelsStepInput, { container }) => {
    if (!input.length) {
      return new StepResponse([] as string[], [] as string[])
    }

    const inventoryModule = container.resolve(Modules.INVENTORY)
    const locking = container.resolve(Modules.LOCKING)
    const inventoryItemIds = input.map((level) => level.inventory_item_id)

    const createdIds = await locking.execute(
      lockKeys(inventoryItemIds),
      async () => {
        const existing = await inventoryModule.listInventoryLevels(
          {
            inventory_item_id: inventoryItemIds,
            location_id: input.map((level) => level.location_id),
          },
          { select: ["id", "inventory_item_id", "location_id"] }
        )
        const missing = input.filter(
          (level) =>
            !existing.some(
              (e) =>
                e.inventory_item_id === level.inventory_item_id &&
                e.location_id === level.location_id
            )
        )
        if (!missing.length) {
          return [] as string[]
        }

        const created = await inventoryModule.createInventoryLevels(missing)
        return created.map((level) => level.id)
      }
    )

    return new StepResponse(createdIds, createdIds)
  },
  async (createdIds, { container }) => {
    if (!createdIds?.length) {
      return
    }

    const inventoryModule = container.resolve(Modules.INVENTORY)
    const locking = container.resolve(Modules.LOCKING)

    const levels = await inventoryModule.listInventoryLevels(
      { id: createdIds },
      { select: ["id", "inventory_item_id"] }
    )
    if (!levels.length) {
      return
    }

    await locking.execute(
      lockKeys(levels.map((level) => level.inventory_item_id)),
      async () => {
        // Re-read under the lock: another receive may have stocked a level
        // this request created. Such a level stays, this request's own
        // stock change was already undone by the adjust step's rollback.
        const current = await inventoryModule.listInventoryLevels(
          { id: createdIds },
          {
            select: [
              "id",
              "stocked_quantity",
              "reserved_quantity",
              "incoming_quantity",
            ],
          }
        )
        const untouched = current.filter(
          (level) =>
            MathBN.eq(level.stocked_quantity, 0) &&
            MathBN.eq(level.reserved_quantity, 0) &&
            MathBN.eq(level.incoming_quantity, 0)
        )
        if (untouched.length) {
          await inventoryModule.deleteInventoryLevels(
            untouched.map((level) => level.id)
          )
        }
      }
    )
  }
)
