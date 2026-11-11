import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildProfitReport } from "../../../modules/accounting/profit"
import { DAY_MS, resolveRange } from "../../../modules/accounting/sales"
import { loadSalesData } from "../sales-report/load-sales-data"
import { loadCostData } from "./load-cost-data"
import type { ProfitReportQuerySchema } from "./middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { from, to, granularity, top } =
    req.validatedQuery as unknown as ProfitReportQuerySchema

  // Throws an INVALID_DATA error (400) for a bad or oversized range.
  const range = resolveRange({ from, to }, new Date())
  const endExclusive = new Date(
    new Date(`${range.to}T00:00:00.000Z`).getTime() + DAY_MS
  )

  const { orders, refunds } = await loadSalesData(req.scope, range)
  const purchases = await loadCostData(req.scope, endExclusive)

  res.json(
    buildProfitReport({
      orders,
      refunds,
      purchases,
      expenses: [], // Task 4 replaces this with the real expense loader.
      ...range,
      granularity,
      top,
    })
  )
}
