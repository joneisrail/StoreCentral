import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import {
  channelOfferLockKey,
  readVariantStock,
} from "../../modules/channel-offers/available-stock"
import { splitEqually } from "../../modules/channel-offers/rules"
import { PURCHASE_MODULE } from "../../modules/purchase"
import type PurchaseModuleService from "../../modules/purchase/service"

export type SplitReceivedStockInput = {
  receipt_id: string
  lines: { variant_id: string; quantity: number }[]
}

export type SplitReceivedStockResult = {
  changed: { variant_id: string; sales_channel_id: string }[]
}

type Applied = {
  variant_id: string
  receipt_id: string
  // Units added per channel by this call (only channels that changed).
  added: Record<string, number>
}

// Ids only, never customer data.
function log(container: Pick<MedusaContainer, "resolve">, message: string) {
  try {
    ;(container.resolve(ContainerRegistrationKeys.LOGGER) as any).warn(message)
  } catch {
    // No logger available.
  }
}

/**
 * Every sales channel id in creation order (created_at ascending, id as the
 * tie-breaker): the order in which odd units are handed out.
 */
export async function readChannelIdsInCreationOrder(
  container: Pick<MedusaContainer, "resolve">
): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "created_at"],
    pagination: { order: { created_at: "ASC" } },
  })
  return (data as { id: string; created_at: string | Date }[])
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return ta === tb ? (a.id < b.id ? -1 : 1) : ta - tb
    })
    .map((c) => c.id)
}

/**
 * Maps the receipt lines (purchase_item_id, quantity) to variants through the
 * purchase items (purchase_item.variant_id) and sums quantities per variant.
 */
export const listReceivedVariantLinesStep = createStep(
  "list-received-variant-lines",
  async (
    input: {
      purchase_id: string
      items: { purchase_item_id: string; quantity: number }[]
    },
    { container }
  ) => {
    const purchaseModule = container.resolve<PurchaseModuleService>(PURCHASE_MODULE)
    const purchase = await purchaseModule.retrievePurchase(input.purchase_id, {
      relations: ["items"],
    })
    const variantByItem = new Map(
      (purchase.items as { id: string; variant_id: string }[]).map((i) => [
        i.id,
        i.variant_id,
      ])
    )
    const totals = new Map<string, number>()
    for (const line of input.items) {
      const variantId = variantByItem.get(line.purchase_item_id)
      if (!variantId || !(line.quantity > 0)) continue
      totals.set(variantId, (totals.get(variantId) ?? 0) + line.quantity)
    }
    return new StepResponse(
      [...totals.entries()].map(([variant_id, quantity]) => ({ variant_id, quantity }))
    )
  }
)

// Subtracts what was added (never below 0) and drops the receipt movements.
async function undo(offers: ChannelOffersModuleService, entry: Applied) {
  const rows = await offers.listForVariant(entry.variant_id)
  const next: Record<string, number> = {}
  for (const row of rows) {
    const add = entry.added[row.sales_channel_id]
    if (add) next[row.sales_channel_id] = Math.max(0, row.stock - add)
  }
  if (Object.keys(next).length) {
    await offers.setStocks(entry.variant_id, next)
    for (const id of Object.keys(next)) {
      await offers.markSync(entry.variant_id, id, { state: "pending" })
    }
  }
  for (const channelId of Object.keys(entry.added)) {
    const found = (await offers.listChannelStockMovements({
      variant_id: entry.variant_id,
      sales_channel_id: channelId,
      kind: "receipt",
      ref: entry.receipt_id,
    })) as unknown as { id: string }[]
    if (found.length) await offers.deleteChannelStockMovements(found.map((r) => r.id))
  }
}

/**
 * Splits the received quantity of each variant equally across ALL channels
 * (odd units to the first channels in creation order). Expected conditions
 * (no channels, unmanaged variant, nothing free) are skipped without
 * throwing. An unexpected error undoes this step's writes and is rethrown,
 * which makes the workflow compensate the earlier steps.
 */
export const splitReceivedStockAcrossChannelsStep = createStep(
  "split-received-stock-across-channels",
  async (input: SplitReceivedStockInput, { container }) => {
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    const locking = container.resolve(Modules.LOCKING)
    const applied: Applied[] = []
    const changed: SplitReceivedStockResult["changed"] = []

    const totals = new Map<string, number>()
    for (const l of input.lines) {
      if (!l.variant_id || !(l.quantity > 0)) continue
      totals.set(l.variant_id, (totals.get(l.variant_id) ?? 0) + l.quantity)
    }

    const channelIds = totals.size ? await readChannelIdsInCreationOrder(container) : []
    if (totals.size && !channelIds.length) {
      log(container, `Channel stock: no sales channels, receipt ${input.receipt_id} not split`)
    }

    try {
      if (channelIds.length) {
        for (const [variantId, quantity] of totals) {
          await locking.execute([channelOfferLockKey(variantId)], async () => {
            const variant = await readVariantStock(container, variantId)
            if (!variant.managed) {
              log(
                container,
                `Channel stock: variant ${variantId} missing or not stock-tracked (receipt ${input.receipt_id}), skipped`
              )
              return
            }

            await offers.ensureOffers([variantId], channelIds)
            const rows = await offers.listForVariant(variantId)

            // Already applied for this receipt (retry or redelivery).
            const done = await offers.listChannelStockMovements({
              kind: "receipt",
              ref: input.receipt_id,
              variant_id: variantId,
            })
            if (done.length) return

            const byChannel = new Map(rows.map((r) => [r.sales_channel_id, r.stock]))
            const sum = channelIds.reduce((s, id) => s + (byChannel.get(id) ?? 0), 0)
            // Available stock already includes the received units; the
            // channels together may never promise more than is available.
            const free = Math.max(0, variant.available - sum)
            const units = Math.min(quantity, free)
            if (units < quantity) {
              log(
                container,
                `Channel stock: variant ${variantId} has only ${free} unallocated of ${quantity} received (receipt ${input.receipt_id})`
              )
            }
            const split = splitEqually(units, channelIds)
            const addedIds = channelIds.filter((id) => split[id] > 0)
            if (!addedIds.length) return

            const entry: Applied = {
              variant_id: variantId,
              receipt_id: input.receipt_id,
              added: Object.fromEntries(addedIds.map((id) => [id, split[id]])),
            }
            applied.push(entry)
            // Stock first, movement second (see apply-order-to-channel-stock).
            await offers.setStocks(
              variantId,
              Object.fromEntries(addedIds.map((id) => [id, (byChannel.get(id) ?? 0) + split[id]]))
            )
            for (const id of addedIds) {
              await offers.markSync(variantId, id, { state: "pending" })
              const ok = await offers.applyMovement({
                kind: "receipt",
                variant_id: variantId,
                sales_channel_id: id,
                delta: split[id],
                ref: input.receipt_id,
              })
              if (!ok) {
                throw new Error(
                  `Receipt movement for variant ${variantId} channel ${id} was not recorded`
                )
              }
              changed.push({ variant_id: variantId, sales_channel_id: id })
            }
          })
        }
      }
    } catch (e) {
      log(container, `Channel stock: failed splitting receipt ${input.receipt_id}, rolling back`)
      for (const entry of [...applied].reverse()) {
        try {
          await locking.execute([channelOfferLockKey(entry.variant_id)], () => undo(offers, entry))
        } catch {
          log(container, `Channel stock: rollback failed for variant ${entry.variant_id}`)
        }
      }
      throw e
    }

    return new StepResponse<SplitReceivedStockResult, Applied[]>({ changed }, applied)
  },
  async (applied, { container }) => {
    if (!applied?.length) return
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    const locking = container.resolve(Modules.LOCKING)
    for (const entry of [...applied].reverse()) {
      await locking.execute([channelOfferLockKey(entry.variant_id)], () => undo(offers, entry))
    }
  }
)
