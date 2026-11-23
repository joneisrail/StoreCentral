import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../../../../../../modules/channel-offers"
import type ChannelOffersModuleService from "../../../../../../modules/channel-offers/service"
import { fetchConnectedChannelIds } from "../../../connections"
import { loadPushValues } from "../../../query"
import { MAX_ERROR_LENGTH, type SyncResultSchema } from "../middlewares"

// seller-hub reports the outcome of a push here. `state` is the only way it
// reports back; the error text is truncated to 500 characters.
export async function POST(req: AuthenticatedMedusaRequest<SyncResultSchema>, res: MedusaResponse) {
  const { variant_id, channel_id } = req.params
  const body = req.validatedBody
  const offers = req.scope.resolve<ChannelOffersModuleService>(CHANNEL_OFFERS_MODULE)
  const [row] = await offers.listChannelOffers(
    { variant_id, sales_channel_id: channel_id },
    { take: 1 }
  )
  if (!row) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Channel offer was not found")
  }
  // A null-price offer follows the base price. Its current effective price
  // decides whether the price part is really synced, so a stock-only push
  // cannot clear a pending base-price change. Best effort: if it cannot be
  // computed, markSync keeps its previous rule and the report still lands.
  let effectivePrice: number | undefined
  if (body.state === "synced" && (row as any).price == null) {
    try {
      const pv = await loadPushValues(
        {
          query: req.scope.resolve(ContainerRegistrationKeys.QUERY) as any,
          offers: offers as any,
          // Strict, as in push-values: a failed lookup falls back below rather
          // than misclassify the channel.
          connectedChannelIds: fetchConnectedChannelIds,
        },
        variant_id,
        channel_id
      )
      effectivePrice = pv.effective_price
    } catch {
      effectivePrice = undefined
    }
  }
  await offers.markSync(variant_id, channel_id, {
    state: body.state,
    error: body.error === undefined ? undefined : body.error.slice(0, MAX_ERROR_LENGTH),
    price: body.price,
    stock: body.stock,
    effectivePrice,
  })
  res.json({ ok: true })
}
