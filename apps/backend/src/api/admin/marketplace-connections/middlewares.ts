import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

const field = z.string().trim().max(2000).optional()

// Blank strings are accepted here and dropped by the route, so a blank secret
// keeps the stored one.
export const SaveConnectionSchema = z.strictObject({
  shop_domain: field,
  access_token: field,
  location_id: field,
  site_url: field,
  consumer_key: field,
  consumer_secret: field,
  webhook_secret: field,
  sales_channel_id: field,
})
export type SaveConnectionSchema = z.infer<typeof SaveConnectionSchema>

export const marketplaceConnectionMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/marketplace-connections/:marketplace",
    method: "POST",
    middlewares: [validateAndTransformBody(SaveConnectionSchema)],
  },
]
