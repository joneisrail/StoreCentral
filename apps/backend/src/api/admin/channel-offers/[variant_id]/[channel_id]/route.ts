import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateChannelOfferWorkflow } from "../../../../../workflows/update-channel-offer"
import type { UpdateChannelOfferSchema } from "./middlewares"

export async function POST(
  req: AuthenticatedMedusaRequest<UpdateChannelOfferSchema>,
  res: MedusaResponse
) {
  const { result } = await updateChannelOfferWorkflow(req.scope).run({
    input: {
      variant_id: req.params.variant_id,
      channel_id: req.params.channel_id,
      ...req.validatedBody,
    },
  })
  res.json(result)
}
