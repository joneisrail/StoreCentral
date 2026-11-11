import {
  MiddlewareRoute,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const ProfitReportQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
  top: z.coerce.number().int().min(1).max(50).default(10),
})
export type ProfitReportQuerySchema = z.infer<typeof ProfitReportQuerySchema>

export const profitReportMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/profit-report",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ProfitReportQuerySchema, { isList: false }),
    ],
  },
]
