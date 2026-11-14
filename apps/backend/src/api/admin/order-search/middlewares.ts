import { MiddlewareRoute, validateAndTransformQuery } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

// All params optional, at least one required; unknown keys are rejected.
export const OrderSearchQuerySchema = z
  .strictObject({
    q: z.string().trim().min(2).max(100).optional(),
    sku: z.string().trim().min(1).max(100).optional(),
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((c) => c.toUpperCase())
      .optional(),
    carrier: z.string().trim().min(1).max(50).optional(),
    ship_from: z.string().trim().min(1).max(100).optional(),
    delivery: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((x) => (typeof x === "string" ? x.trim().length > 0 : x !== undefined)), {
    message: "Provide at least one search parameter",
  })
export type OrderSearchQuerySchema = z.infer<typeof OrderSearchQuerySchema>

export const orderSearchMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/order-search",
    method: "GET",
    middlewares: [validateAndTransformQuery(OrderSearchQuerySchema, { defaults: ["id"], isList: false })],
  },
]
