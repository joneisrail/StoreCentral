import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import type { SyncState } from "../../modules/channel-offers/service"
import type { FindDriftedOutput } from "./find-drifted-base-price-offers"

export type PreviousSyncState = {
  variant_id: string
  channel_id: string
  id: string
  sync_state: SyncState
  last_error: string | null
}

export type MarkOffersPendingOutput = { variant_id: string; marked: string[] }

// Puts back exactly the sync_state (and, for "failed", the error) an offer had
// before it was marked pending. "synced" is written directly: markSync would
// re-derive it from stock/price and stamp last_synced_at.
export const restorePreviousSyncStates = async (
  container: MedusaContainer,
  previous: PreviousSyncState[] | undefined
): Promise<void> => {
  if (!previous?.length) return
  const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
  for (const p of previous) {
    if (p.sync_state === "synced") {
      await offers.updateChannelOffers({ id: p.id, sync_state: "synced" } as any)
    } else if (p.sync_state === "failed") {
      await offers.markSync(p.variant_id, p.channel_id, {
        state: "failed",
        error: p.last_error ?? undefined,
      })
    } else {
      await offers.markSync(p.variant_id, p.channel_id, { state: "pending" })
    }
  }
}

// Marks each drifted channel's offer pending (sync_state only; markSync also
// clears last_error). Offers already pending are left alone, so a repeat run
// has no effect and nothing to compensate.
export const markOffersPendingStep = createStep(
  "mark-offers-pending",
  async (input: FindDriftedOutput, { container }) => {
    const out: MarkOffersPendingOutput = { variant_id: input.variant_id, marked: [] }
    if (!input.drifted.length) return new StepResponse(out, [] as PreviousSyncState[])

    const offers = container.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
    const rows = await offers.listForVariant(input.variant_id)
    const previous: PreviousSyncState[] = []
    for (const d of input.drifted) {
      const row = rows.find((r) => r.sales_channel_id === d.channel_id)
      if (!row || row.sync_state === "pending") continue
      previous.push({
        variant_id: input.variant_id,
        channel_id: d.channel_id,
        id: row.id,
        sync_state: row.sync_state,
        last_error: row.last_error ?? null,
      })
      await offers.markSync(input.variant_id, d.channel_id, { state: "pending" })
      out.marked.push(d.channel_id)
    }
    return new StepResponse(out, previous)
  },
  async (previous, { container }) => {
    await restorePreviousSyncStates(container, previous)
  }
)
