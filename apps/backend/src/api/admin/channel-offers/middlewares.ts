import { MiddlewareRoute, validateAndTransformQuery } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

// `order`: name | total | unallocated | <channel_id>:stock | <channel_id>:price,
// optionally prefixed with `-` for descending. Default: total ascending.
export const ChannelOffersGridQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  order: z
    .string()
    .regex(/^-?(name|total|unallocated|[A-Za-z0-9_]+:(stock|price))$/)
    .default("total"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  channel_ids: z
    .string()
    .max(2000)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .optional(),
})
export type ChannelOffersGridQuery = z.infer<typeof ChannelOffersGridQuerySchema>

export const channelOffersGridMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/channel-offers",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ChannelOffersGridQuerySchema, { defaults: ["id"], isList: false }),
    ],
  },
]
