import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildSalesReport, resolveRange } from "../../../modules/accounting/sales"
import { loadSalesData } from "./load-sales-data"
import type { SalesReportQuerySchema } from "./middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { from, to, granularity, top } =
    req.validatedQuery as unknown as SalesReportQuerySchema

  // Throws an INVALID_DATA error (400) for a bad or oversized range.
  const range = resolveRange({ from, to }, new Date())
  const { orders, refunds } = await loadSalesData(req.scope, range)

  res.json(buildSalesReport({ orders, refunds, ...range, granularity, top }))
}
