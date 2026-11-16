import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../../../modules/channel-offers"
import { callSellerHub } from "../marketplace-connections/seller-hub-client"
import type { ChannelOffersGridQuery } from "./middlewares"
import { loadGrid } from "./query"

const HUB_TIMEOUT_MS = 4000

// Sales channels with a seller-hub connection. Any failure (not configured,
// unreachable, rejected secret, non-200, odd body) means "none": the grid still
// answers. Nothing is logged: errors from the client carry fixed messages only.
async function connectedChannelIds(): Promise<Set<string>> {
  try {
    const { status, body } = await callSellerHub("GET", "/internal/connections", undefined, {
      timeoutMs: HUB_TIMEOUT_MS,
    })
    if (status !== 200 || !Array.isArray(body?.connections)) return new Set()
    return new Set(
      body.connections
        .filter((c: any) => c && typeof c.sales_channel_id === "string" && c.status !== "disconnected")
        .map((c: any) => c.sales_channel_id as string)
    )
  } catch {
    return new Set()
  }
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const params = req.validatedQuery as unknown as ChannelOffersGridQuery
  const result = await loadGrid(
    {
      query: req.scope.resolve(ContainerRegistrationKeys.QUERY) as any,
      offers: req.scope.resolve(CHANNEL_OFFERS_MODULE) as any,
      connectedChannelIds,
    },
    params
  )
  res.json(result)
}
