import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const HoldOrderSchema = z.strictObject({
  reason: z.string().trim().min(1).max(255),
})
export type HoldOrderSchema = z.infer<typeof HoldOrderSchema>

export const ReleaseOrderSchema = z.strictObject({})
export type ReleaseOrderSchema = z.infer<typeof ReleaseOrderSchema>

export const VoidOrderLabelSchema = z.strictObject({})
export type VoidOrderLabelSchema = z.infer<typeof VoidOrderLabelSchema>

export const MarkShippedSchema = z.strictObject({
  carrier: z.string().trim().min(1).max(100),
  tracking_number: z.string().trim().min(1).max(100),
  tracking_url: z.url().optional(),
  shipped_at: z.iso.datetime().optional(),
  no_notification: z.boolean().optional(),
  location_id: z.string().optional(),
})
export type MarkShippedSchema = z.infer<typeof MarkShippedSchema>

export const orderHoldMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/orders/:id/mark-shipped",
    method: "POST",
    middlewares: [validateAndTransformBody(MarkShippedSchema)],
  },
  {
    matcher: "/admin/orders/:id/void-label",
    method: "POST",
    middlewares: [validateAndTransformBody(VoidOrderLabelSchema)],
  },
  {
    matcher: "/admin/orders/:id/hold",
    method: "POST",
    middlewares: [validateAndTransformBody(HoldOrderSchema)],
  },
  {
    matcher: "/admin/orders/:id/release",
    method: "POST",
    middlewares: [validateAndTransformBody(ReleaseOrderSchema)],
  },
]
