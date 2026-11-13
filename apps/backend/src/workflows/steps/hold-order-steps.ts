import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export const HOLD_TAG_VALUE = "On hold"

// Anything not in this list counts as shipped for the purpose of holding.
const OPEN_FULFILLMENT_STATUSES = ["not_fulfilled", "partially_fulfilled", "canceled"]

export type ValidateOrderHoldInput = { order_id: string; mode: "hold" | "release" }
export type ValidatedOrderHoldState = {
  order_id: string
  metadata: Record<string, unknown>
  hold_tag_ids: string[]
}

// Reads the order and rejects states in which it cannot be held or released.
export const validateOrderHoldStep = createStep(
  "validate-order-hold",
  async (input: ValidateOrderHoldInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "status", "fulfillment_status", "metadata", "tags.id", "tags.value"],
      filters: { id: input.order_id },
    })
    const order = data[0] as any
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} was not found`)
    }
    if (order.status === "canceled") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "A canceled order cannot be held or released")
    }
    const holdTagIds: string[] = (order.tags ?? [])
      .filter((t: any) => t?.value === HOLD_TAG_VALUE)
      .map((t: any) => t.id)
    const held = holdTagIds.length > 0

    if (input.mode === "hold") {
      if (order.fulfillment_status && !OPEN_FULFILLMENT_STATUSES.includes(order.fulfillment_status)) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "A fulfilled or shipped order cannot be put on hold"
        )
      }
      if (held) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The order is already on hold")
      }
    } else if (!held) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The order is not on hold")
    }

    return new StepResponse<ValidatedOrderHoldState>({
      order_id: order.id,
      metadata: order.metadata ?? {},
      hold_tag_ids: holdTagIds,
    })
  }
)

// Finds the shared "On hold" tag, or null when it was never created.
export const findHoldTagStep = createStep("find-hold-tag", async (_input: void, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_tag",
    fields: ["id", "value"],
    filters: { value: HOLD_TAG_VALUE },
  })
  const tag = (data as any[]).find((t) => t.value === HOLD_TAG_VALUE)
  return new StepResponse<{ id: string } | null>(tag ? { id: tag.id } : null)
})
