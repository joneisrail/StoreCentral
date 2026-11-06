import {
  MiddlewareRoute,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const SupplierOffersQuerySchema = z.object({
  product_id: z.string().trim().min(1),
})
export type SupplierOffersQuerySchema = z.infer<
  typeof SupplierOffersQuerySchema
>

export const supplierOfferMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/supplier-offers",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(SupplierOffersQuerySchema, {
        defaults: ["id"],
        isList: false,
      }),
    ],
  },
]
