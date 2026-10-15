import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * The two Medusa event names this subscriber forwards to Seller Hub's
 * webhook receiver (`apps/seller-hub/src/webhook/server.ts`), confirmed
 * empirically against a real running local Medusa backend (Task 9 Step 1):
 *
 * - Updating an inventory level's stocked quantity via
 *   `POST /admin/inventory-items/{id}/location-levels/{location_id}` fires
 *   "inventory-level.updated" with `data: { id: <inventory_level_id> }`.
 * - Updating a variant's price via
 *   `POST /admin/products/{id}/variants/{variant_id}` (the admin
 *   dashboard's own "edit price" flow) fires "product-variant.updated"
 *   with `data: { id: <variant_id> }`.
 *
 * (Both updates also fire a module-internal, differently-prefixed event --
 * e.g. "inventory.inventory-level.updated" and "pricing.price.updated" --
 * but those are each module's own internal event, not the conventional
 * public event name documented for subscribers, so they aren't used here.)
 */
export const INVENTORY_LEVEL_UPDATED_EVENT = "inventory-level.updated"
export const PRODUCT_VARIANT_UPDATED_EVENT = "product-variant.updated"

/**
 * Forwards an inventory/price change event to Seller Hub's webhook
 * receiver, so its BullMQ push-workers (Task 8) eventually sync the change
 * to Amazon.
 *
 * The forward is best-effort: a Seller Hub outage (unreachable webhook
 * server, non-2xx response, network error) is logged but never thrown,
 * since a third-party sync service being down must never break Medusa's
 * own event processing (blast-radius requirement).
 */
export default async function sellerHubSyncHandler({
  event,
}: SubscriberArgs<{ id: string }>) {
  const webhookBaseUrl = process.env.SELLER_HUB_WEBHOOK_URL
  if (!webhookBaseUrl) {
    console.error(
      `[seller-hub-sync] SELLER_HUB_WEBHOOK_URL is not set -- dropping event "${event.name}"`
    )
    return
  }

  try {
    const response = await fetch(`${webhookBaseUrl}/webhooks/medusa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: event.name, data: event.data }),
    })

    if (!response.ok) {
      console.error(
        `[seller-hub-sync] webhook receiver responded with status ${response.status} for event "${event.name}"`
      )
    }
  } catch (err) {
    console.error(
      `[seller-hub-sync] failed to forward event "${event.name}" to Seller Hub:`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: [INVENTORY_LEVEL_UPDATED_EVENT, PRODUCT_VARIANT_UPDATED_EVENT],
}
