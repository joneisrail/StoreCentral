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

export const channelOfferMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/channel-offers/:variant_id/:channel_id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateChannelOfferSchema)],
  },
]
