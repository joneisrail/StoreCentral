import {
  MiddlewareRoute,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const ListSupplierBalancesQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListSupplierBalancesQuerySchema = z.infer<
  typeof ListSupplierBalancesQuerySchema
>

export const supplierBalanceMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/supplier-balances",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ListSupplierBalancesQuerySchema, {
        defaults: ["id"],
        isList: true,
      }),
    ],
  },
]
