import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import {
  channelOfferLockKey,
  readVariantStock,
} from "../../modules/channel-offers/available-stock"
import { deduct, resplitPool } from "../../modules/channel-offers/rules"
import { readShareStockSetting } from "../../modules/channel-offers/settings"

export type ApplyOrderMode = "placed" | "canceled"

export type ApplyOrderToChannelStockInput = {
  order_id: string
  mode: ApplyOrderMode
}

export type OrderStockLines = {
  sales_channel_id: string | null
  items: { id: string; variant_id: string | null; quantity: number }[]
}

/**
 * The single place the channel and lines of an order are read: query.graph on
 * `order` with sales_channel_id, items.id, items.variant_id, items.quantity.
 * Returns null when the order does not exist.
 */
export async function readOrderStockLines(
  container: Pick<MedusaContainer, "resolve">,
  orderId: string
): Promise<OrderStockLines | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "sales_channel_id", "items.id", "items.variant_id", "items.quantity"],
    filters: { id: orderId },
  })
  const order = data[0]
  if (!order) return null
  return {
    sales_channel_id: order.sales_channel_id ?? null,
    items: (order.items ?? []).map((i: any) => ({
      id: i.id,
      variant_id: i.variant_id ?? null,
      quantity: Number(i.quantity),
    })),
  }
}

type Applied = {
  variant_id: string
  ref: string
  kind: "order" | "cancel"
  previous: Record<string, number>
  previous_sync: Record<string, "synced" | "pending" | "failed">
}

export type ApplyOrderResult = {
  changed: { variant_id: string; sales_channel_id: string }[]
}

// Ids only, never customer data.
function log(container: Pick<MedusaContainer, "resolve">, message: string) {
  try {
    ;(container.resolve(ContainerRegistrationKeys.LOGGER) as any).warn(message)
  } catch {
    // No logger available.
  }
}

async function removeMovements(
  offers: ChannelOffersModuleService,
  variantId: string,
  ref: string,
  kind: "order" | "cancel"
) {
  const rows = (await offers.listChannelStockMovements({
    variant_id: variantId,
    ref: [ref],
    kind: [kind, "rebalance"],
  })) as unknown as { id: string }[]
  if (rows.length) {
    await offers.deleteChannelStockMovements(rows.map((r) => r.id))
  }
}

export const applyOrderToChannelStockStep = createStep(
  "apply-order-to-channel-stock",
  async (input: ApplyOrderToChannelStockInput, { container }) => {
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    const locking = container.resolve(Modules.LOCKING)
    const kind = input.mode === "placed" ? "order" : "cancel"

    const empty: ApplyOrderResult = { changed: [] }
    const order = await readOrderStockLines(container, input.order_id)
    if (!order) {
      log(container, `Channel stock: order ${input.order_id} not found, skipped`)
      return new StepResponse<ApplyOrderResult, Applied[]>(empty, [])
    }
    if (!order.sales_channel_id) {
      log(container, `Channel stock: order ${input.order_id} has no sales channel, skipped`)
      return new StepResponse<ApplyOrderResult, Applied[]>(empty, [])
    }
    const channelId = order.sales_channel_id
    const share = await readShareStockSetting(container)

    const applied: Applied[] = []
    const changed = new Map<string, { variant_id: string; sales_channel_id: string }>()

    for (const line of order.items) {
      if (!line.variant_id || !(line.quantity > 0)) continue
      const variantId = line.variant_id

      await locking.execute([channelOfferLockKey(variantId)], async () => {
        const variant = await readVariantStock(container, variantId)
        if (!variant.managed) return

        const rows = await offers.listForVariant(variantId)
        const row = rows.find((r) => r.sales_channel_id === channelId)
        if (!row) {
          log(
            container,
            `Channel stock: variant ${variantId} has no offer for channel ${channelId} (order ${input.order_id}), skipped`
          )
          return
        }

        const ids = rows.map((r) => r.sales_channel_id)
        const before = Object.fromEntries(rows.map((r) => [r.sales_channel_id, r.stock]))
        let direct: Record<string, number>
        if (input.mode === "placed") {
          direct = deduct(before, channelId, line.quantity)
        } else {
          // Never let the channels together promise more than is available.
          const sum = Object.values(before).reduce((s, v) => s + v, 0)
          const free = Math.max(0, variant.available - sum)
          direct = { ...before, [channelId]: before[channelId] + Math.min(line.quantity, free) }
        }
        const final = share ? resplitPool(direct, ids) : direct

        // The movement is the idempotency gate: one per order line and kind.
        const first = await offers.applyMovement({
          kind,
          variant_id: variantId,
          sales_channel_id: channelId,
          delta: direct[channelId] - before[channelId],
          ref: line.id,
        })
        if (!first) return

        try {
          for (const id of ids) {
            const d = final[id] - direct[id]
            if (d !== 0) {
              await offers.applyMovement({
                kind: "rebalance",
                variant_id: variantId,
                sales_channel_id: id,
                delta: d,
                ref: line.id,
              })
            }
          }
          const changedIds = ids.filter((id) => final[id] !== before[id])
          const entry: Applied = {
            variant_id: variantId,
            ref: line.id,
            kind,
            previous: Object.fromEntries(changedIds.map((id) => [id, before[id]])),
            previous_sync: Object.fromEntries(
              rows
                .filter((r) => changedIds.includes(r.sales_channel_id))
                .map((r) => [r.sales_channel_id, r.sync_state])
            ),
          }
          if (changedIds.length) {
            await offers.setStocks(
              variantId,
              Object.fromEntries(changedIds.map((id) => [id, final[id]]))
            )
            for (const id of changedIds) {
              await offers.markSync(variantId, id, { state: "pending" })
              changed.set(`${variantId}|${id}`, { variant_id: variantId, sales_channel_id: id })
            }
          }
          applied.push(entry)
        } catch (e) {
          await removeMovements(offers, variantId, line.id, kind)
          throw e
        }
      })
    }

    return new StepResponse<ApplyOrderResult, Applied[]>(
      { changed: [...changed.values()] },
      applied
    )
  },
  async (applied, { container }) => {
    if (!applied?.length) return
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    const locking = container.resolve(Modules.LOCKING)
    for (const entry of [...applied].reverse()) {
      await locking.execute([channelOfferLockKey(entry.variant_id)], async () => {
        if (Object.keys(entry.previous).length) {
          await offers.setStocks(entry.variant_id, entry.previous)
          for (const [id, state] of Object.entries(entry.previous_sync)) {
            await offers.markSync(entry.variant_id, id, { state })
          }
        }
        await removeMovements(offers, entry.variant_id, entry.ref, entry.kind)
      })
    }
  }
)
