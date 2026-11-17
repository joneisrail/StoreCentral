import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../../../modules/channel-offers"
import { STOCK_ROWS_SQL } from "../../../modules/channel-offers/stock-rows"
import { connectedChannelIds } from "./connections"
import type { ChannelOffersGridQuery } from "./middlewares"
import { loadGrid } from "./query"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const params = req.validatedQuery as unknown as ChannelOffersGridQuery
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const result = await loadGrid(
    {
      query: req.scope.resolve(ContainerRegistrationKeys.QUERY) as any,
      offers: req.scope.resolve(CHANNEL_OFFERS_MODULE) as any,
      stockRows: async () => (await pg.raw(STOCK_ROWS_SQL)).rows,
      connectedChannelIds,
    },
    params
  )
  res.json(result)
}
