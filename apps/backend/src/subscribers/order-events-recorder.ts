import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { ORDER_EVENTS_MODULE } from "../modules/order-events"

// Core's order.canceled event carries no actor, so the event is recorded as
// "unknown". Best-effort: never throws, logs only the order id.
export default async function orderEventsRecorder({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event?.data?.id
  try {
    const service = container.resolve(ORDER_EVENTS_MODULE) as any
    await service.recordOrderEvent({ order_id: orderId, type: "order.canceled", actor: "unknown" })
  } catch {
    try {
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(`Failed to record order event order.canceled for order ${orderId}`)
    } catch {
      // No logger available.
    }
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.CANCELED,
}
