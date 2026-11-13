import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

const field = z.string().trim().max(2000).optional()

// Credential fields shared by create and edit (display_name is create-only). Blank strings are accepted here
// and dropped by the route, so a blank secret keeps the stored one.
const credentialFields = {
  shop_domain: field,
  access_token: field,
  location_id: field,
  site_url: field,
  consumer_key: field,
  consumer_secret: field,
  webhook_secret: field,
  seller_id: field,
  marketplace_id: field,
  refresh_token: field,
}

export const MARKETPLACES = ["shopify", "woocommerce", "amazon"] as const

// Either `name` (create the channel, then connect) or `sales_channel_id`
// (attach to an existing channel); description and is_disabled only go with name.
export const CreateConnectionSchema = z
  .strictObject({
    marketplace: z.enum(MARKETPLACES),
    name: z.string().trim().min(1).max(255).optional(),
    sales_channel_id: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2000).optional(),
    display_name: field,
    is_disabled: z.boolean().optional(),
    ...credentialFields,
  })
  .refine((b) => (b.name === undefined) !== (b.sales_channel_id === undefined), {
    message: "Provide either name or sales_channel_id",
  })
  .refine(
    (b) => b.name !== undefined || (b.description === undefined && b.is_disabled === undefined),
    { message: "description and is_disabled are only valid with name" }
  )
export type CreateConnectionSchema = z.infer<typeof CreateConnectionSchema>

export const SaveConnectionSchema = z.strictObject(credentialFields)
export type SaveConnectionSchema = z.infer<typeof SaveConnectionSchema>

export const marketplaceConnectionMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/marketplace-connections",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateConnectionSchema)],
  },
  {
    matcher: "/admin/marketplace-connections/:id",
    method: "POST",
    middlewares: [validateAndTransformBody(SaveConnectionSchema)],
  },
]
