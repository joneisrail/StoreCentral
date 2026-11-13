import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export const HOLD_TAG_VALUE = "On hold"

// Anything not in this list counts as shipped for the purpose of holding.
const OPEN_FULFILLMENT_STATUSES = ["not_fulfilled", "partially_fulfilled", "canceled"]

type FulfillmentTimestamps = {
  packed_at?: unknown
  shipped_at?: unknown
  delivered_at?: unknown
  canceled_at?: unknown
}

// fulfillment_status is not a persisted order column: core derives it from the
// fulfillments relation (getLastFulfillmentStatus in core-flows, order/utils/
// aggregate-status.ts). This mirrors that logic without the unfulfilled-items
// refinement, which only ever turns a complete status into a partial one.
export function deriveFulfillmentStatus(fulfillments: FulfillmentTimestamps[]): string {
  const counts = { canceled: 0, delivered: 0, shipped: 0, fulfilled: 0 }
  for (const fulfillment of fulfillments) {
    if (fulfillment.canceled_at) counts.canceled++
    else if (fulfillment.delivered_at) counts.delivered++
    else if (fulfillment.shipped_at) counts.shipped++
    else if (fulfillment.packed_at) counts.fulfilled++
  }
  const live = fulfillments.length - counts.canceled
  if (counts.delivered > 0) return counts.delivered === live ? "delivered" : "partially_delivered"
  if (counts.shipped > 0) return counts.shipped === live ? "shipped" : "partially_shipped"
  if (counts.fulfilled > 0) return counts.fulfilled === live ? "fulfilled" : "partially_fulfilled"
  if (counts.canceled > 0 && counts.canceled === fulfillments.length) return "canceled"
  return "not_fulfilled"
}

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
      fields: ["id", "status", "fulfillments.id", "fulfillments.packed_at", "fulfillments.shipped_at", "fulfillments.delivered_at", "fulfillments.canceled_at", "metadata", "tags.id", "tags.value"],
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
      if (!Array.isArray(order.fulfillments)) {
        // Fail closed: without the fulfillments we cannot tell whether it shipped.
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "The order's fulfillments could not be read, so it cannot be put on hold"
        )
      }
      if (!OPEN_FULFILLMENT_STATUSES.includes(deriveFulfillmentStatus(order.fulfillments))) {
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
