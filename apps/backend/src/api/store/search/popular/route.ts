import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { rankPopular } from "../../../../modules/search-insights/helpers/popular"
import { SEARCH_INSIGHTS_MODULE } from "../../../../modules/search-insights"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: any = req.scope.resolve(SEARCH_INSIGHTS_MODULE)
  const now = new Date()
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const rows = await service.listSearchQueries(
    {
      last_seen_at: { $gte: since },
      count: { $gte: 2 },
      results_count: { $gt: 0 },
    },
    { order: { count: "DESC" }, take: 200 }
  )
  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({ queries: rankPopular(rows, now) })
}
