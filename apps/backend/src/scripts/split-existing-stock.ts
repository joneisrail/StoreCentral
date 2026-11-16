/**
 * One-time split of each variant's current stock equally across the sales
 * channels (remainder to the earliest-created channels). Nothing is pushed to
 * marketplaces and no channel-offer.changed event is emitted.
 *
 * DRY RUN BY DEFAULT: it only counts what would be split. It writes only when
 * the exact positional word `apply` is passed (flags such as --dry-run are
 * swallowed by `medusa exec` and never reach the script):
 *
 *   npx medusa exec ./src/scripts/split-existing-stock.ts          (dry run)
 *   npx medusa exec ./src/scripts/split-existing-stock.ts apply    (writes)
 *
 * Run in a quiet period (no orders or stock edits in flight). Safe to re-run,
 * also after an interruption: a variant with any nonzero channel stock, or
 * with an `initial-split:<variant_id>` movement, is left alone. Available
 * stock is re-read under each variant's lock and the split never exceeds it.
 * Logs counts only. Never run by the build.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import { CHANNEL_OFFERS_MODULE } from "../modules/channel-offers"
import {
  availableFromItems,
  channelOfferLockKey,
  readVariantStock,
} from "../modules/channel-offers/available-stock"
import { splitEqually } from "../modules/channel-offers/rules"
import { STOCK_ROWS_SQL, type StockRow } from "../modules/channel-offers/stock-rows"
import { readChannelIdsInCreationOrder } from "../workflows/steps/split-received-stock-across-channels"

export const SPLIT_BATCH_SIZE = 500

export type SplitInput = {
  variant_id: string
  available: number
  existing: Record<string, number>
}
export type SplitPlan = { variant_id: string; stocks: Record<string, number> }

/**
 * Pure planner. Skips variants that already have any nonzero channel stock
 * (already split or edited) and variants with nothing available (a later run
 * splits them once they are stocked and still have no channel stock).
 */
export function planInitialSplit(variants: SplitInput[], channelIds: string[]): SplitPlan[] {
  if (!channelIds.length) return []
  const plans: SplitPlan[] = []
  for (const v of variants) {
    if (Object.values(v.existing).some((n) => n !== 0)) continue
    if (!(v.available > 0)) continue
    plans.push({ variant_id: v.variant_id, stocks: splitEqually(v.available, channelIds) })
  }
  return plans
}

export const initialSplitRef = (variantId: string) => `initial-split:${variantId}`

export type SplitResult = { checked: number; split: number; skipped: number }

type Container = { resolve: (key: any) => any }

async function plan(
  offers: any,
  variant: { variant_id: string; available: number },
  channelIds: string[]
): Promise<SplitPlan | null> {
  const done = await offers.listChannelStockMovements(
    { kind: "rebalance", ref: initialSplitRef(variant.variant_id), variant_id: variant.variant_id },
    { select: ["id"], take: 1, withDeleted: true }
  )
  if (done.length) return null
  const rows = await offers.listForVariant(variant.variant_id)
  const existing: Record<string, number> = {}
  for (const r of rows) existing[r.sales_channel_id] = r.stock
  return planInitialSplit([{ ...variant, existing }], channelIds)[0] ?? null
}

/**
 * Applies the split for one batch of variants. Every variant is decided again
 * under its lock, so concurrent edits and re-runs are respected. Stock is
 * written first, then the movements: an interruption in between leaves nonzero
 * stock, which a re-run skips. Emits no events.
 */
export async function splitVariants(
  container: Container,
  variants: { variant_id: string; available: number }[],
  channelIds: string[],
  opts: {
    dryRun: boolean
    readStock?: (
      container: Container,
      variantId: string
    ) => Promise<{ managed: boolean; available: number }>
  }
): Promise<SplitResult> {
  const offers = container.resolve(CHANNEL_OFFERS_MODULE)
  const result: SplitResult = { checked: variants.length, split: 0, skipped: 0 }

  if (opts.dryRun) {
    for (const v of variants) {
      if (await plan(offers, v, channelIds)) result.split++
      else result.skipped++
    }
    return result
  }

  const readStock = opts.readStock ?? readVariantStock
  const locking = container.resolve(Modules.LOCKING)
  for (const v of variants) {
    const applied = await locking.execute([channelOfferLockKey(v.variant_id)], async () => {
      // The bulk snapshot may be stale: use the lower of it and the live value.
      const live = await readStock(container, v.variant_id)
      if (!live.managed) return false
      const available = Math.min(v.available, live.available)
      const p = await plan(offers, { variant_id: v.variant_id, available }, channelIds)
      if (!p) return false
      await offers.ensureOffers([p.variant_id], channelIds)
      await offers.setStocks(p.variant_id, p.stocks)
      for (const [channel, stock] of Object.entries(p.stocks)) {
        if (stock <= 0) continue
        await offers.applyMovement({
          kind: "rebalance",
          variant_id: p.variant_id,
          sales_channel_id: channel,
          delta: stock,
          ref: initialSplitRef(p.variant_id),
        })
      }
      return true
    })
    if (applied) result.split++
    else result.skipped++
  }
  return result
}

export default async function splitExistingStock({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const dryRun = !(args ?? []).includes("apply")

  const channelIds = await readChannelIdsInCreationOrder(container)
  logger.info(`split-existing-stock: ${channelIds.length} channels${dryRun ? " (dry run, nothing will be written)" : ""}`)
  if (!channelIds.length) return

  const itemsByVariant = new Map<string, { required_quantity: number | null; net: number }[]>()
  for (const r of (await pg.raw(STOCK_ROWS_SQL)).rows as StockRow[]) {
    const list = itemsByVariant.get(r.variant_id) ?? []
    list.push({ required_quantity: r.required_quantity, net: Number(r.net ?? 0) })
    itemsByVariant.set(r.variant_id, list)
  }

  const total: SplitResult = { checked: 0, split: 0, skipped: 0 }
  for (let skip = 0; ; skip += SPLIT_BATCH_SIZE) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "manage_inventory"],
      pagination: { skip, take: SPLIT_BATCH_SIZE, order: { id: "ASC" } },
    })
    const rows = data as { id: string; manage_inventory: boolean }[]
    const batch = rows.map((v) => ({
      variant_id: v.id,
      available: availableFromItems(!!v.manage_inventory, itemsByVariant.get(v.id) ?? []),
    }))
    const r = await splitVariants(container, batch, channelIds, { dryRun })
    total.checked += r.checked
    total.split += r.split
    total.skipped += r.skipped
    logger.info(
      `split-existing-stock: batch ${skip / SPLIT_BATCH_SIZE + 1} checked ${r.checked}, split ${r.split}, skipped ${r.skipped}`
    )
    if (rows.length < SPLIT_BATCH_SIZE) break
  }
  logger.info(
    `split-existing-stock: done${dryRun ? " (dry run, nothing written)" : ""}: checked ${total.checked}, ${dryRun ? "would split" : "split"} ${total.split}, skipped ${total.skipped}`
  )
  if (dryRun) {
    logger.info(
      "split-existing-stock: to apply run: npx medusa exec ./src/scripts/split-existing-stock.ts apply"
    )
  }
}
