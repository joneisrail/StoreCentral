import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../../../../../../modules/channel-offers"
import type ChannelOffersModuleService from "../../../../../../modules/channel-offers/service"
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
  await offers.markSync(variant_id, channel_id, {
    state: body.state,
    error: body.error === undefined ? undefined : body.error.slice(0, MAX_ERROR_LENGTH),
    price: body.price,
    stock: body.stock,
  })
  res.json({ ok: true })
}
