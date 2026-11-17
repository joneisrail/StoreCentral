import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requestChannelSyncWorkflow } from "../../../../../../workflows/request-channel-sync"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { result } = await requestChannelSyncWorkflow(req.scope).run({
    input: { variant_id: req.params.variant_id, channel_id: req.params.channel_id },
  })
  res.json(result)
}
