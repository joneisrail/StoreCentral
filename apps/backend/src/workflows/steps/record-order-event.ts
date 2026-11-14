import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ORDER_EVENTS_MODULE } from "../../modules/order-events"
import type { OrderEventType } from "../../modules/order-events"

export type RecordOrderEventStepInput = {
  order_id: string
  type: OrderEventType
  actor?: string | null
  old_value?: unknown
  new_value?: unknown
}

// Best-effort audit write: the action being recorded has already succeeded, so
// a failure here (including an unregistered module) must never fail it and
// there is nothing to compensate. Only the order id and event type are logged.
export const recordOrderEventStep = createStep(
  "record-order-event",
  async (input: RecordOrderEventStepInput, { container }) => {
    try {
      const service = container.resolve(ORDER_EVENTS_MODULE) as {
        recordOrderEvent: (i: {
          order_id: string
          type: OrderEventType
          actor: string
          old_value?: unknown
          new_value?: unknown
        }) => Promise<void>
      }
      await service.recordOrderEvent({
        order_id: input.order_id,
        type: input.type,
        actor: input.actor ?? "unknown",
        old_value: input.old_value,
        new_value: input.new_value,
      })
    } catch {
      try {
        container
          .resolve(ContainerRegistrationKeys.LOGGER)
          .warn(`Failed to record order event ${input.type} for order ${input.order_id}`)
      } catch {
        // No logger available.
      }
    }
    return new StepResponse(undefined)
  }
)
