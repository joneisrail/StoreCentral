import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import { readChannelIdsInCreationOrder } from "./split-received-stock-across-channels"

export type EnsureChannelOffersInput = {
  /** A new variant: ensure its rows across all channels. */
  variant_id?: string
  /** A new channel: ensure rows for all variants (stock 0, never takes stock). */
  sales_channel_id?: string
}

export const ENSURE_BATCH_SIZE = 500

/**
 * Creates only the missing rows (ensureOffers is idempotent and race tolerant,
 * and never changes existing stock, so no lock is needed). No compensation:
 * extra empty rows are harmless and expected for every variant and channel.
 */
export const ensureChannelOffersStep = createStep(
  "ensure-channel-offers",
  async (input: EnsureChannelOffersInput, { container }) => {
    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    let checked = 0
    if (input.variant_id) {
      const channelIds = await readChannelIdsInCreationOrder(container)
      await offers.ensureOffers([input.variant_id], channelIds)
      checked += 1
    }
    if (input.sales_channel_id) {
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      for (let skip = 0; ; skip += ENSURE_BATCH_SIZE) {
        const { data } = await query.graph({
          entity: "product_variant",
          fields: ["id"],
          pagination: { skip, take: ENSURE_BATCH_SIZE, order: { id: "ASC" } },
        })
        const ids = (data as { id: string }[]).map((v) => v.id)
        if (ids.length) await offers.ensureOffers(ids, [input.sales_channel_id])
        checked += ids.length
        if (ids.length < ENSURE_BATCH_SIZE) break
      }
    }
    return new StepResponse({ checked })
  }
)
