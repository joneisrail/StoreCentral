import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import { fetchConnectedChannelIds } from "../../api/admin/channel-offers/connections"
import { loadPushValues } from "../../api/admin/channel-offers/query"

export type OfferDriftInput = {
  channel_id: string
  price: number | null
  last_synced_price: number | null
  sync_state: string
}

export const PRICE_EPSILON = 0.005

// Pure: offers that follow the base price (price null), are connected, and drifted.
export const selectDriftedOffers = (
  offers: OfferDriftInput[],
  effectiveByChannel: Record<string, number>,
  connected: Set<string>
): { channel_id: string; previous_sync_state: string }[] => {
  const out: { channel_id: string; previous_sync_state: string }[] = []
  for (const o of offers) {
    if (o.price !== null || !connected.has(o.channel_id)) continue
    const effective = effectiveByChannel[o.channel_id]
    if (effective === undefined) continue
    const drifted =
      o.last_synced_price === null ||
      Math.abs(effective - o.last_synced_price) >= PRICE_EPSILON
    if (drifted) out.push({ channel_id: o.channel_id, previous_sync_state: o.sync_state })
  }
  return out
}

export type FindDriftedInput = { variant_id: string }
export type FindDriftedOutput = {
  variant_id: string
  drifted: { channel_id: string; previous_sync_state: string }[]
}

const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export const findDriftedBasePriceOffersStep = createStep(
  "find-drifted-base-price-offers",
  async (input: FindDriftedInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)

    const rows = await offers.listForVariant(input.variant_id)
    const candidates = rows.filter((r) => toNum(r.price) === null)
    if (!candidates.length) {
      return new StepResponse<FindDriftedOutput>({ variant_id: input.variant_id, drifted: [] })
    }

    const connected = await fetchConnectedChannelIds()
    const connectedCandidates = candidates.filter((r) => connected.has(r.sales_channel_id))
    const effectiveByChannel: Record<string, number> = {}
    for (const r of connectedCandidates) {
      const pv = await loadPushValues(
        { query, offers, connectedChannelIds: fetchConnectedChannelIds },
        input.variant_id,
        r.sales_channel_id
      )
      effectiveByChannel[r.sales_channel_id] = pv.effective_price
    }

    const drifted = selectDriftedOffers(
      rows.map((r) => ({
        channel_id: r.sales_channel_id,
        price: toNum(r.price),
        last_synced_price: toNum(r.last_synced_price),
        sync_state: r.sync_state,
      })),
      effectiveByChannel,
      connected
    )
    return new StepResponse<FindDriftedOutput>({ variant_id: input.variant_id, drifted })
  }
)
