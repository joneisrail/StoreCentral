import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../modules/channel-offers"
import propagateBasePriceWorkflow from "../workflows/propagate-base-price"

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
 * Per-channel stock/price change (emitted by the channel offer edit, order,
 * receipt, trim and sync-request workflows). Forwarded as
 * `{ variant_id, sales_channel_id, kind, force, manual? }`. The backend
 * ALWAYS forwards; Seller Hub decides what to push: stock changes always,
 * price changes only when `force` is true (sync icon) or the connection has
 * auto_sync_price on.
 */
export const CHANNEL_OFFER_CHANGED_EVENT = "channel-offer.changed"
const OFFER_KINDS = new Set(["stock", "price", "both"])

function warn(message: string) {
  console.error(`[seller-hub-sync] ${message}`)
}

/**
 * Legacy variant-level events (inventory-level.updated, product-variant.updated)
 * are dropped only for variants that have offer rows for EVERY current sales
 * channel (the one-time split is complete for them); those are synced through
 * channel-offer.changed instead. For product-variant.updated on such a variant
 * the propagate-base-price workflow runs (it marks drifted inheriting offers
 * pending and emits channel-offer.changed). A variant with no or only some rows keeps the
 * legacy forward so channels without a row never miss a Medusa stock update.
 * Returns true when the legacy event should be forwarded: any affected variant
 * not fully covered, no resolvable variant, or a failed lookup (fail open to
 * the old behaviour).
 */
async function shouldForwardLegacy(
  event: { name: string; data: { id: string } },
  container: SubscriberArgs<unknown>["container"]
): Promise<boolean> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    let variantIds: string[]
    if (event.name === PRODUCT_VARIANT_UPDATED_EVENT) {
      variantIds = [event.data.id]
    } else {
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["id", "inventory_item_id"],
        filters: { id: event.data.id },
      })
      const itemId = levels?.[0]?.inventory_item_id
      if (!itemId) return true
      const { data: items } = await query.graph({
        entity: "inventory_item",
        fields: ["id", "variants.id"],
        filters: { id: itemId },
      })
      variantIds = (items?.[0]?.variants ?? []).map((v: { id: string }) => v.id)
    }
    if (!variantIds.length) return true
    const { data: channels } = await query.graph({
      entity: "sales_channel",
      fields: ["id"],
    })
    const channelIds: string[] = (channels ?? []).map((c: { id: string }) => c.id)
    if (!channelIds.length) return true
    const offers = container.resolve(CHANNEL_OFFERS_MODULE) as any
    const rows: { variant_id: string; sales_channel_id: string }[] =
      await offers.listChannelOffers(
        { variant_id: variantIds },
        { select: ["variant_id", "sales_channel_id"], take: null }
      )
    const covered = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!covered.has(r.variant_id)) covered.set(r.variant_id, new Set())
      covered.get(r.variant_id)!.add(r.sales_channel_id)
    }
    return variantIds.some((id) => !channelIds.every((c) => covered.get(id)?.has(c)))
  } catch (err) {
    warn(
      `offer lookup failed for event "${event.name}" (${
        err instanceof Error ? err.name : typeof err
      }) -- forwarding the legacy event`
    )
    return true
  }
}

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
}: SubscriberArgs<any>) {
  const webhookBaseUrl = process.env.SELLER_HUB_WEBHOOK_URL
  if (!webhookBaseUrl) {
    console.error(
      `[seller-hub-sync] SELLER_HUB_WEBHOOK_URL is not set -- dropping event "${event.name}"`
    )
    return
  }

  try {
    let data: Record<string, unknown> = event.data
    if (event.name === CHANNEL_OFFER_CHANGED_EVENT) {
      const d = event.data ?? {}
      if (
        typeof d.variant_id !== "string" ||
        typeof d.sales_channel_id !== "string" ||
        !OFFER_KINDS.has(d.kind)
      ) {
        warn(`malformed payload -- dropping event "${event.name}"`)
        return
      }
      data = {
        variant_id: d.variant_id,
        sales_channel_id: d.sales_channel_id,
        kind: d.kind,
        force: d.force === true,
        ...(d.manual === true ? { manual: true } : {}),
      }
    } else if (
      event.name === INVENTORY_LEVEL_UPDATED_EVENT ||
      event.name === PRODUCT_VARIANT_UPDATED_EVENT
    ) {
      if (!(await shouldForwardLegacy(event, container))) {
        if (event.name === PRODUCT_VARIANT_UPDATED_EVENT) {
          // Fully covered variant: base-price edits are propagated per channel
          // by the workflow instead of the legacy variant-level forward.
          await propagateBasePriceWorkflow(container).run({
            input: { variant_id: event.data.id },
          })
        }
        return
      }
    }
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
    CHANNEL_OFFER_CHANGED_EVENT,
  ],
}
