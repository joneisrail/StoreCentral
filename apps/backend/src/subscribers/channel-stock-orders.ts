import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { applyOrderToChannelStockWorkflow } from "../workflows/apply-order-to-channel-stock"

// Applies a placed or canceled order to the per-channel stock. Best-effort:
// never throws (the event stays handled), logs only the order id. The
// workflow is idempotent per order line, so a redelivered event is harmless.
export default async function channelStockOrders({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event?.data?.id
  const mode = event?.name === OrderWorkflowEvents.CANCELED ? "canceled" : "placed"
  try {
    await applyOrderToChannelStockWorkflow(container).run({
      input: { order_id: orderId, mode },
    })
  } catch {
    try {
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(`Failed to apply order ${orderId} to channel stock (${mode})`)
    } catch {
      // No logger available.
    }
  }
}

export const config: SubscriberConfig = {
  event: [OrderWorkflowEvents.PLACED, OrderWorkflowEvents.CANCELED],
}
