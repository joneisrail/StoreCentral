import {
  MiddlewareRoute,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const CreatePurchaseSchema = z.object({
  supplier_id: z.string().min(1),
  items: z
    .array(
      z.object({
        variant_id: z.string().min(1),
        quantity: z.number().int().min(1),
        unit_cost: z.number().min(0),
      })
    )
    .min(1),
  shipping_cost: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  other_cost: z.number().min(0).optional(),
  notes: z.string().optional(),
})
export type CreatePurchaseSchema = z.infer<typeof CreatePurchaseSchema>

export const UpdatePurchaseSchema = z.object({
  items: z
    .array(
      z.object({
        variant_id: z.string().min(1),
        quantity: z.number().int().min(1),
        unit_cost: z.number().min(0),
      })
    )
    .min(1)
    .optional(),
  shipping_cost: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  other_cost: z.number().min(0).optional(),
  notes: z.string().optional(),
})
export type UpdatePurchaseSchema = z.infer<typeof UpdatePurchaseSchema>

export const ListPurchasesQuerySchema = z.object({
  status: z
    .enum(["draft", "ordered", "partially_received", "received", "cancelled"])
    .optional(),
  supplier_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListPurchasesQuerySchema = z.infer<typeof ListPurchasesQuerySchema>

export const ReceivePurchaseSchema = z.object({
  stock_location_id: z.string().min(1),
  items: z
    .array(
      z.object({
        purchase_item_id: z.string().min(1),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
  note: z.string().optional(),
})
export type ReceivePurchaseSchema = z.infer<typeof ReceivePurchaseSchema>

export const purchaseMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/purchases",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ListPurchasesQuerySchema, {
        defaults: ["id"],
        isList: true,
      }),
    ],
  },
  {
    matcher: "/admin/purchases",
    method: "POST",
    middlewares: [validateAndTransformBody(CreatePurchaseSchema)],
  },
  {
    matcher: "/admin/purchases/:id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdatePurchaseSchema)],
  },
  {
    matcher: "/admin/purchases/:id/receive",
    method: "POST",
    middlewares: [validateAndTransformBody(ReceivePurchaseSchema)],
  },
]
