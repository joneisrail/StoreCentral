import {
  MiddlewareRoute,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const SalesReportQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
  top: z.coerce.number().int().min(1).max(50).default(10),
})
export type SalesReportQuerySchema = z.infer<typeof SalesReportQuerySchema>

export const salesReportMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/sales-report",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(SalesReportQuerySchema, {
        defaults: ["id"],
        isList: false,
      }),
    ],
  },
]
