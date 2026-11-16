import { randomUUID } from "crypto"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import {
  channelOfferLockKey,
  readVariantStock,
} from "../../modules/channel-offers/available-stock"
import { trimToTotal } from "../../modules/channel-offers/rules"

export type TrimChannelStockInput = { variant_id: string }
export type TrimChannelStockResult = {
  changed: { variant_id: string; sales_channel_id: string }[]
}

export type Applied = {
  variant_id: string
  ref: string
  trimmed: Record<string, number>
  // Stock per trimmed channel read under the lock before the write, and the
  // value this step wrote.
  previous: Record<string, number>
  after: Record<string, number>
}

// Ids only.
function log(container: Pick<MedusaContainer, "resolve">, message: string) {
  try {
    ;(container.resolve(ContainerRegistrationKeys.LOGGER) as any).warn(message)
  } catch {
    // No logger available.
  }
}

// Gives back what was trimmed under ONE shared budget: free = available - sum
// of the current stock. Each trimmed channel (in channel order) is restored to
// its snapshot when nobody changed it since, or gets back at most the trimmed
// units when it changed; either way the increase is capped by what is still
// free, so the sum can never end above the available total.
async function undo(
  container: Pick<MedusaContainer, "resolve">,
  offers: ChannelOffersModuleService,
  entry: Applied
) {
  const rows = await offers.listForVariant(entry.variant_id)
  const variant = await readVariantStock(container, entry.variant_id)
  const sum = rows.reduce((s, r) => s + r.stock, 0)
  let free = Math.max(0, variant.available - sum)
  const next: Record<string, number> = {}
  for (const row of rows) {
    const id = row.sales_channel_id
    if (!(id in entry.trimmed)) continue
    const target =
      row.stock === entry.after[id]
        ? entry.previous[id]
        : row.stock + entry.trimmed[id]
    const add = Math.min(Math.max(0, target - row.stock), free)
    free -= add
    if (add > 0) next[id] = row.stock + add
  }
  if (Object.keys(next).length) {
    await offers.setStocks(entry.variant_id, next)
    for (const id of Object.keys(next)) {
      await offers.markSync(entry.variant_id, id, { state: "pending" })
    }
  }
  for (const channelId of Object.keys(entry.trimmed)) {
    const found = (await offers.listChannelStockMovements({
      variant_id: entry.variant_id,
      sales_channel_id: channelId,
      kind: "trim",
      ref: entry.ref,
    })) as unknown as { id: string }[]
    if (found.length) await offers.deleteChannelStockMovements(found.map((r) => r.id))
  }
}

/**
 * When the sum of channel stock exceeds the variant's available stock (the
 * total fell), trims the largest channel first and records `trim` movements.
 * Does nothing when the sum is within the total (increases stay unallocated).
 */
export const trimChannelStockStep = createStep(
  "trim-channel-stock",
  async (input: TrimChannelStockInput, { container }) => {
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    const locking = container.resolve(Modules.LOCKING)
    const changed: TrimChannelStockResult["changed"] = []
    const applied: Applied[] = []
    const variantId = input.variant_id

    try {
      await locking.execute([channelOfferLockKey(variantId)], async () => {
        const variant = await readVariantStock(container, variantId)
        // Missing or unmanaged (no stock tracking): rows hold no promise to trim.
        if (!variant.exists || !variant.managed) return
        const rows = await offers.listForVariant(variantId)
        const stocks = Object.fromEntries(rows.map((r) => [r.sales_channel_id, r.stock]))
        const sum = Object.values(stocks).reduce((s, n) => s + n, 0)
        const total = variant.available
        if (sum <= total) return

        const order = rows.map((r) => r.sales_channel_id)
        const { stocks: next, trimmed } = trimToTotal(stocks, total, order)
        const ids = order.filter((id) => trimmed[id] > 0)
        if (!ids.length) return

        const ref = `trim:${randomUUID()}`
        const after = Object.fromEntries(ids.map((id) => [id, next[id]]))
        // Stock first, movement second (see apply-order-to-channel-stock).
        // Recorded for rollback only once the stock write succeeded.
        await offers.setStocks(variantId, after)
        applied.push({
          variant_id: variantId,
          ref,
          trimmed,
          previous: Object.fromEntries(ids.map((id) => [id, stocks[id]])),
          after,
        })
        for (const id of ids) {
          await offers.markSync(variantId, id, { state: "pending" })
          const ok = await offers.applyMovement({
            kind: "trim",
            variant_id: variantId,
            sales_channel_id: id,
            delta: -trimmed[id],
            ref,
          })
          if (!ok) {
            throw new Error(`Trim movement for variant ${variantId} channel ${id} was not recorded`)
          }
          changed.push({ variant_id: variantId, sales_channel_id: id })
        }
      })
    } catch (e) {
      log(container, `Channel stock: failed trimming variant ${variantId}, rolling back`)
      for (const entry of [...applied].reverse()) {
        try {
          await locking.execute([channelOfferLockKey(entry.variant_id)], () => undo(container, offers, entry))
        } catch {
          log(container, `Channel stock: rollback failed for variant ${entry.variant_id}`)
        }
      }
      throw e
    }

    return new StepResponse<TrimChannelStockResult, Applied[]>({ changed }, applied)
  },
  async (applied, { container }) => {
    await compensateTrims(container, applied)
  }
)

/** Undoes each entry on its own: one failing entry never skips the rest. */
export async function compensateTrims(
  container: Pick<MedusaContainer, "resolve">,
  applied: Applied[] | undefined
) {
  if (!applied?.length) return
  const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
  const locking = container.resolve(Modules.LOCKING)
  for (const entry of [...applied].reverse()) {
    try {
      await locking.execute([channelOfferLockKey(entry.variant_id)], () =>
        undo(container, offers, entry)
      )
    } catch {
      log(container, `Channel stock: trim rollback failed for variant ${entry.variant_id}`)
    }
  }
}
