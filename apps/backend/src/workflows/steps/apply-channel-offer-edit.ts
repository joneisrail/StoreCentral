import { randomUUID } from "crypto"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { CHANNEL_OFFERS_MODULE } from "../../modules/channel-offers"
import type ChannelOffersModuleService from "../../modules/channel-offers/service"
import {
  channelOfferLockKey,
  readVariantStock,
} from "../../modules/channel-offers/available-stock"
import {
  NO_STOCK_TRACKING_MESSAGE,
  type ChannelOfferEditInput,
} from "./validate-channel-offer-edit"

type Compensation = {
  variant_id: string
  channel_id: string
  price?: number | null
  stock?: number
  sync_state: "synced" | "pending" | "failed"
}

export const applyChannelOfferEditStep = createStep(
  "apply-channel-offer-edit",
  async (input: ChannelOfferEditInput, { container }) => {
    const offers = container.resolve<ChannelOffersModuleService>(
      CHANNEL_OFFERS_MODULE
    )
    const locking = container.resolve(Modules.LOCKING)

    // The variant lock serialises every edit of this variant's channel stock,
    // so the other channels' totals read here cannot change before we write.
    const compensation = await locking.execute(
      [channelOfferLockKey(input.variant_id)],
      async (): Promise<Compensation> => {
        await offers.ensureOffers([input.variant_id], [input.channel_id])
        const rows = await offers.listForVariant(input.variant_id)
        const row = rows.find((r) => r.sales_channel_id === input.channel_id)
        if (!row) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `No channel offer for variant ${input.variant_id} on channel ${input.channel_id}`
          )
        }

        if (input.stock !== undefined) {
          const variant = await readVariantStock(container, input.variant_id)
          if (!variant.managed) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              NO_STOCK_TRACKING_MESSAGE
            )
          }
          const others = rows
            .filter((r) => r.sales_channel_id !== input.channel_id)
            .reduce((s, r) => s + r.stock, 0)
          const free = Math.max(0, variant.available - others)
          if (input.stock > free) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Only ${free} unit${free === 1 ? "" : "s"} can still be allocated to this channel (${variant.available} available, ${others} allocated to other channels)`
            )
          }
        }

        const previous: Compensation = {
          variant_id: input.variant_id,
          channel_id: input.channel_id,
          sync_state: row.sync_state,
        }
        if (input.stock !== undefined) {
          previous.stock = row.stock
          await offers.setStocks(input.variant_id, {
            [input.channel_id]: input.stock,
          })
          await offers.applyMovement({
            kind: "edit",
            variant_id: input.variant_id,
            sales_channel_id: input.channel_id,
            delta: input.stock - row.stock,
            ref: `edit:${randomUUID()}`,
          })
        }
        if (input.price !== undefined) {
          previous.price = row.price
          await offers.setPrice(input.variant_id, input.channel_id, input.price)
        }
        await offers.markSync(input.variant_id, input.channel_id, {
          state: "pending",
        })
        return previous
      }
    )
    return new StepResponse(undefined, compensation)
  },
  async (previous, { container }) => {
    if (!previous) return
    const offers = container.resolve<ChannelOffersModuleService>(
      CHANNEL_OFFERS_MODULE
    )
    await container
      .resolve(Modules.LOCKING)
      .execute([channelOfferLockKey(previous.variant_id)], async () => {
        if (previous.stock !== undefined) {
          await offers.setStocks(previous.variant_id, {
            [previous.channel_id]: previous.stock,
          })
        }
        if (previous.price !== undefined) {
          await offers.setPrice(
            previous.variant_id,
            previous.channel_id,
            previous.price
          )
        }
        await offers.markSync(previous.variant_id, previous.channel_id, {
          state: previous.sync_state,
        })
      })
  }
)
