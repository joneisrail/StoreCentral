import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const UpdateChannelOfferSchema = z
  .strictObject({
    price: z.number().nonnegative().nullable().optional(),
    stock: z.number().int().nonnegative().optional(),
  })
  .refine((b) => b.price !== undefined || b.stock !== undefined, {
    message: "Provide a price or stock to update",
  })
export type UpdateChannelOfferSchema = z.infer<typeof UpdateChannelOfferSchema>

export const MAX_ERROR_LENGTH = 500
// seller-hub reports a push outcome with `state` only. Long error text is
// accepted (up to a hard input bound) and truncated to MAX_ERROR_LENGTH, so a
// verbose marketplace error never loses the failure report.
export const SyncResultSchema = z.strictObject({
  state: z.enum(["synced", "failed"]),
  error: z.string().max(10_000).optional(),
  price: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
})
export type SyncResultSchema = z.infer<typeof SyncResultSchema>

export const channelOfferMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/channel-offers/:variant_id/:channel_id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateChannelOfferSchema)],
  },
  {
    matcher: "/admin/channel-offers/:variant_id/:channel_id/sync-result",
    method: "POST",
    middlewares: [validateAndTransformBody(SyncResultSchema)],
  },
]
