import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../../../../../../modules/channel-offers"
import { connectedChannelIds } from "../../../connections"
import { loadPushValues } from "../../../query"

// Read only. Called by seller-hub (admin credentials) right before it pushes.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const values = await loadPushValues(
    {
      query: req.scope.resolve(ContainerRegistrationKeys.QUERY) as any,
      offers: req.scope.resolve(CHANNEL_OFFERS_MODULE) as any,
      connectedChannelIds,
    },
    req.params.variant_id,
    req.params.channel_id
  )
  res.json(values)
}
