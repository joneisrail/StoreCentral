import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { trimChannelStockWorkflow } from "../workflows/trim-channel-stock"

function warn(container: SubscriberArgs<unknown>["container"], message: string) {
  try {
    container.resolve(ContainerRegistrationKeys.LOGGER).warn(message)
  } catch {
    // No logger available.
  }
}

// When an inventory level changes, trims channel stock of the linked
// variants if it now exceeds the available total. Our own channel stock
// writes never change Medusa's total, so this cannot loop. Best-effort:
// never throws, logs only ids.
export default async function channelStockTrim({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const levelId = event?.data?.id
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id"],
      filters: { id: levelId },
    })
    const itemId = levels?.[0]?.inventory_item_id
    if (!itemId) return
    const { data: items } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "variants.id"],
      filters: { id: itemId },
    })
    const variantIds: string[] = (items?.[0]?.variants ?? []).map((v: { id: string }) => v.id)
    for (const variantId of variantIds) {
      try {
        await trimChannelStockWorkflow(container).run({ input: { variant_id: variantId } })
      } catch {
        warn(container, `Failed to trim channel stock for variant ${variantId}`)
      }
    }
  } catch {
    warn(container, `Failed to trim channel stock for inventory level ${levelId}`)
  }
}

export const config: SubscriberConfig = {
  event: "inventory-level.updated",
}
