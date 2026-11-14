import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The Medusa event names this subscriber forwards to Seller Hub's
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
 * Emitted by createOrderShipmentWorkflow with
 * `data: { id: <fulfillment id>, no_notification }`. The fulfillment id alone
 * is useless to Seller Hub, so the owning order id is resolved through the
 * order<->fulfillment link and sent along.
 */
export const SHIPMENT_CREATED_EVENT = "shipment.created"

/**
 * Resolves the order that owns a fulfillment through the order<->fulfillment
 * link. Shared with the mark-shipped integration spec so the two cannot drift.
 */
export async function resolveOrderIdForFulfillment(
  query: { graph: (args: any) => Promise<{ data?: any[] }> },
  fulfillmentId: string
): Promise<string | undefined> {
  const { data: links } = await query.graph({
    entity: "order_fulfillment",
    fields: ["order_id"],
    filters: { fulfillment_id: fulfillmentId },
  })
  return links?.[0]?.order_id
}

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
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
  const webhookBaseUrl = process.env.SELLER_HUB_WEBHOOK_URL
  if (!webhookBaseUrl) {
    console.error(
      `[seller-hub-sync] SELLER_HUB_WEBHOOK_URL is not set -- dropping event "${event.name}"`
    )
    return
  }

  try {
    let data: Record<string, unknown> = event.data
    if (event.name === SHIPMENT_CREATED_EVENT) {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const orderId = await resolveOrderIdForFulfillment(query, event.data.id)
      if (!orderId) {
        console.error(
          `[seller-hub-sync] no order found for fulfillment ${event.data.id} -- dropping event "${event.name}"`
        )
        return
      }
      data = {
        id: event.data.id,
        order_id: orderId,
        no_notification: event.data.no_notification === true,
      }
    }

    const response = await fetch(`${webhookBaseUrl}/webhooks/medusa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: event.name, data }),
    })

    if (!response.ok) {
      console.error(
        `[seller-hub-sync] webhook receiver responded with status ${response.status} for event "${event.name}"`
      )
    }
  } catch (err) {
    console.error(
      `[seller-hub-sync] failed to forward event "${event.name}" to Seller Hub: ${
        err instanceof Error ? err.name : typeof err
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    INVENTORY_LEVEL_UPDATED_EVENT,
    PRODUCT_VARIANT_UPDATED_EVENT,
    SHIPMENT_CREATED_EVENT,
  ],
}
