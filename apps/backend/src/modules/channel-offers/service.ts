import { MedusaService } from "@medusajs/framework/utils"
import ChannelOffer from "./models/channel-offer"
import ChannelStockMovement from "./models/channel-stock-movement"

export const MOVEMENT_KINDS = [
  "order",
  "cancel",
  "receipt",
  "edit",
  "rebalance",
  "trim",
] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]

export type SyncState = "synced" | "pending" | "failed"

export type ChannelOfferRecord = {
  id: string
  variant_id: string
  sales_channel_id: string
  price: number | null
  stock: number
  last_synced_price: number | null
  last_synced_stock: number | null
  last_synced_at: Date | string | null
  sync_state: SyncState
  last_error: string | null
  channel_order: number
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined
  const msg = (err?.message ?? "").toLowerCase()
  return (
    err?.code === "23505" ||
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("already exists")
  )
}

class ChannelOffersModuleService extends MedusaService({
  ChannelOffer,
  ChannelStockMovement,
}) {
  /**
   * Creates missing (variant, channel) rows with stock 0 and price null.
   * Existing rows are never touched. Safe under concurrent callers: a unique
   * violation re-reads the existing rows and inserts only what is still
   * missing (up to 3 attempts).
   *
   * IMPORTANT: `channelIds` MUST be passed in channel creation order (callers
   * sort by the sales channel's created_at), because `channel_order` records
   * the order in which channels are first seen. A channel that already has
   * rows (for any variant) keeps its order; a new channel gets
   * (max existing channel_order + 1), recomputed on every attempt. Concurrent
   * calls may in rare cases produce equal values for different channels;
   * listForVariant breaks ties by id.
   */
  async ensureOffers(
    variantIds: string[],
    channelIds: string[]
  ): Promise<void> {
    if (!variantIds.length || !channelIds.length) return

    for (let attempt = 1; ; attempt++) {
      const channelRows = (await this.listChannelOffers(
        { sales_channel_id: channelIds },
        { select: ["sales_channel_id", "channel_order"] }
      )) as unknown as { sales_channel_id: string; channel_order: number }[]
      const orderByChannel = new Map<string, number>()
      for (const r of channelRows) {
        orderByChannel.set(r.sales_channel_id, r.channel_order)
      }

      const missingChannels = channelIds.filter((c) => !orderByChannel.has(c))
      if (missingChannels.length) {
        const [top] = (await this.listChannelOffers(
          {},
          {
            select: ["channel_order"],
            order: { channel_order: "DESC" },
            take: 1,
          }
        )) as unknown as { channel_order: number }[]
        let next = (top?.channel_order ?? 0) + 1
        for (const c of missingChannels) orderByChannel.set(c, next++)
      }

      const existing = (await this.listChannelOffers(
        { variant_id: variantIds, sales_channel_id: channelIds },
        { select: ["variant_id", "sales_channel_id"] }
      )) as unknown as { variant_id: string; sales_channel_id: string }[]
      const have = new Set(
        existing.map((e) => `${e.variant_id}|${e.sales_channel_id}`)
      )

      const toCreate: Record<string, unknown>[] = []
      for (const variant_id of variantIds) {
        for (const sales_channel_id of channelIds) {
          if (have.has(`${variant_id}|${sales_channel_id}`)) continue
          toCreate.push({
            variant_id,
            sales_channel_id,
            price: null,
            stock: 0,
            sync_state: "pending",
            channel_order: orderByChannel.get(sales_channel_id)!,
          })
        }
      }
      if (!toCreate.length) return
      try {
        await this.createChannelOffers(toCreate as any)
        return
      } catch (e) {
        if (!isUniqueViolation(e) || attempt >= 3) throw e
      }
    }
  }

  async listForVariant(variantId: string): Promise<ChannelOfferRecord[]> {
    const rows = await this.listChannelOffers(
      { variant_id: variantId },
      { order: { channel_order: "ASC", id: "ASC" } }
    )
    const num = (v: unknown) => (v == null ? null : Number(v))
    return rows.map((r: any) => ({
      ...r,
      price: num(r.price),
      last_synced_price: num(r.last_synced_price),
    })) as unknown as ChannelOfferRecord[]
  }

  /**
   * Records a stock movement. Returns false (and records nothing) when a
   * movement with the same (kind, ref, variant, channel) already exists,
   * including when a concurrent caller wins the insert race (unique
   * violation). It does not change the offer's stock; the caller sets it.
   */
  async applyMovement(m: {
    kind: MovementKind
    variant_id: string
    sales_channel_id: string
    delta: number
    ref?: string
  }): Promise<boolean> {
    if (m.ref != null) {
      const dup = await this.listChannelStockMovements(
        {
          kind: m.kind,
          ref: m.ref,
          variant_id: m.variant_id,
          sales_channel_id: m.sales_channel_id,
        },
        { select: ["id"], take: 1, withDeleted: true }
      )
      if (dup.length) return false
    }
    try {
      await this.createChannelStockMovements({
        kind: m.kind,
        variant_id: m.variant_id,
        sales_channel_id: m.sales_channel_id,
        delta: m.delta,
        ref: m.ref ?? null,
      } as any)
    } catch (e) {
      if (isUniqueViolation(e)) return false
      throw e
    }
    return true
  }

  async setStocks(
    variantId: string,
    stocks: Record<string, number>
  ): Promise<void> {
    for (const [channel, v] of Object.entries(stocks)) {
      if (!(v >= 0)) {
        throw new Error(`Stock for channel ${channel} must be >= 0 (got ${v})`)
      }
    }
    const rows = await this.listChannelOffers({
      variant_id: variantId,
      sales_channel_id: Object.keys(stocks),
    })
    const updates = rows.map((r: any) => ({
      id: r.id,
      stock: stocks[r.sales_channel_id],
    }))
    if (updates.length) await this.updateChannelOffers(updates as any)
  }

  async setPrice(
    variantId: string,
    channelId: string,
    price: number | null
  ): Promise<void> {
    if (price !== null && !(price >= 0)) {
      throw new Error(`Price must be >= 0 or null (got ${price})`)
    }
    const row = await this.findOffer(variantId, channelId)
    if (row) await this.updateChannelOffers({ id: row.id, price } as any)
  }

  async markSync(
    variantId: string,
    channelId: string,
    r: { state: SyncState; error?: string; price?: number; stock?: number }
  ): Promise<void> {
    const row = await this.findOffer(variantId, channelId)
    if (!row) return
    const patch: Record<string, unknown> = {
      id: row.id,
      sync_state: r.state,
      last_error: r.state === "failed" ? r.error ?? null : null,
    }
    if (r.state === "synced") {
      patch.last_synced_at = new Date()
      if (r.price !== undefined) patch.last_synced_price = r.price
      if (r.stock !== undefined) patch.last_synced_stock = r.stock
    }
    await this.updateChannelOffers(patch as any)
  }

  private async findOffer(variantId: string, channelId: string) {
    const [row] = await this.listChannelOffers(
      { variant_id: variantId, sales_channel_id: channelId },
      { take: 1 }
    )
    return row as { id: string } | undefined
  }
}

export default ChannelOffersModuleService
