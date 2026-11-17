import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import {
  channelOfferLockKey,
  readVariantStock,
} from "../../modules/channel-offers/available-stock"
import { deduct, resplitPool, trimToTotal } from "../../modules/channel-offers/rules"
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

type MovementKey = {
  kind: "order" | "cancel" | "rebalance" | "trim"
  ref: string
  sales_channel_id: string
}

type Applied = {
  variant_id: string
  previous: Record<string, number>
  previous_sync: Record<string, "synced" | "pending" | "failed">
  // Exactly the movement rows created by this call.
  movements: MovementKey[]
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
  keys: MovementKey[]
) {
  for (const k of keys) {
    const rows = (await offers.listChannelStockMovements({
      variant_id: variantId,
      sales_channel_id: k.sales_channel_id,
      kind: k.kind,
      ref: k.ref,
    })) as unknown as { id: string }[]
    if (rows.length) await offers.deleteChannelStockMovements(rows.map((r) => r.id))
  }
}

async function restore(offers: ChannelOffersModuleService, variantId: string, e: Applied) {
  if (Object.keys(e.previous).length) {
    await offers.setStocks(variantId, e.previous)
    for (const [id, state] of Object.entries(e.previous_sync)) {
      await offers.markSync(variantId, id, { state })
    }
  }
  await removeMovements(offers, variantId, e.movements)
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
        if (!variant.managed) {
          log(
            container,
            `Channel stock: variant ${variantId} missing or not stock-tracked (order ${input.order_id}), skipped`
          )
          return
        }

        const rows = await offers.listForVariant(variantId)
        const row = rows.find((r) => r.sales_channel_id === channelId)
        if (!row) {
          log(
            container,
            `Channel stock: variant ${variantId} has no offer for channel ${channelId} (order ${input.order_id}), skipped`
          )
          return
        }

        // Already applied for this line and kind (redelivered event).
        const done = await offers.listChannelStockMovements({
          kind,
          ref: line.id,
          variant_id: variantId,
          sales_channel_id: channelId,
        })
        if (done.length) return

        const ids = rows.map((r) => r.sales_channel_id)
        const before = Object.fromEntries(rows.map((r) => [r.sales_channel_id, r.stock]))
        let direct: Record<string, number>
        if (input.mode === "placed") {
          direct = deduct(before, channelId, line.quantity)
        } else {
          // Add back only what the order movement of this very line deducted.
          const [deductedRow] = (await offers.listChannelStockMovements({
            kind: "order",
            ref: line.id,
            variant_id: variantId,
            sales_channel_id: channelId,
          })) as unknown as { delta: number }[]
          if (!deductedRow) {
            log(
              container,
              `Channel stock: line ${line.id} of order ${input.order_id} has no recorded deduction, cancel skipped`
            )
            return
          }
          const deducted = Math.max(0, -Number(deductedRow.delta))
          // Never let the channels together promise more than is available.
          const sum = Object.values(before).reduce((s, v) => s + v, 0)
          const free = Math.max(0, variant.available - sum)
          direct = { ...before, [channelId]: before[channelId] + Math.min(deducted, free) }
        }
        const pooled = share ? resplitPool(direct, ids) : direct
        // The reservation of this order already lowered the available total
        // (live re-read under the lock): channels together must never promise
        // more than is available, so trim immediately instead of waiting for a
        // fulfillment event. Cancel add-back is unaffected (its own cap).
        let final = pooled
        let trimmed: Record<string, number> = {}
        if (input.mode === "placed") {
          const live = await readVariantStock(container, variantId)
          const sumNow = Object.values(pooled).reduce((s, v) => s + v, 0)
          if (live.exists && live.managed && sumNow > live.available) {
            const t = trimToTotal(pooled, live.available, ids)
            final = t.stocks
            trimmed = t.trimmed
          }
        }
        const changedIds = ids.filter((id) => final[id] !== before[id])
        const entry: Applied = {
          variant_id: variantId,
          previous: Object.fromEntries(changedIds.map((id) => [id, before[id]])),
          previous_sync: Object.fromEntries(
            rows
              .filter((r) => changedIds.includes(r.sales_channel_id))
              .map((r) => [r.sales_channel_id, r.sync_state])
          ),
          movements: [],
        }

        try {
          // Stock first, movement second: a crash in between double-applies on
          // redelivery (never oversells) instead of silently losing a deduction.
          if (changedIds.length) {
            await offers.setStocks(
              variantId,
              Object.fromEntries(changedIds.map((id) => [id, final[id]]))
            )
            for (const id of changedIds) await offers.markSync(variantId, id, { state: "pending" })
          }
          const ok = await offers.applyMovement({
            kind,
            variant_id: variantId,
            sales_channel_id: channelId,
            delta: direct[channelId] - before[channelId],
            ref: line.id,
          })
          if (!ok) throw new Error(`Movement for line ${line.id} was not recorded`)
          entry.movements.push({ kind, ref: line.id, sales_channel_id: channelId })
          const rebalanceRef = `${input.mode}:${line.id}`
          for (const id of ids) {
            const d = pooled[id] - direct[id]
            if (d === 0) continue
            const rec = await offers.applyMovement({
              kind: "rebalance",
              variant_id: variantId,
              sales_channel_id: id,
              delta: d,
              ref: rebalanceRef,
            })
            if (!rec) throw new Error(`Rebalance movement for line ${line.id} was not recorded`)
            entry.movements.push({ kind: "rebalance", ref: rebalanceRef, sales_channel_id: id })
          }
          const trimRef = `placed-trim:${line.id}`
          for (const id of ids) {
            if (!(trimmed[id] > 0)) continue
            const rec = await offers.applyMovement({
              kind: "trim",
              variant_id: variantId,
              sales_channel_id: id,
              delta: -trimmed[id],
              ref: trimRef,
            })
            if (!rec) throw new Error(`Trim movement for line ${line.id} was not recorded`)
            entry.movements.push({ kind: "trim", ref: trimRef, sales_channel_id: id })
          }
        } catch (e) {
          log(
            container,
            `Channel stock: failed applying line ${line.id} of order ${input.order_id}, rolling back`
          )
          try {
            await restore(offers, variantId, entry)
          } catch {
            log(container, `Channel stock: rollback failed for line ${line.id}`)
          }
          throw e
        }
        for (const id of changedIds) {
          changed.set(`${variantId}|${id}`, { variant_id: variantId, sales_channel_id: id })
        }
        applied.push(entry)
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
      await locking.execute([channelOfferLockKey(entry.variant_id)], () =>
        restore(offers, entry.variant_id, entry)
      )
    }
  }
)
