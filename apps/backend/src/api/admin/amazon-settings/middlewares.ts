import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

const field = z.string().trim().max(2048).optional()

// Blank or absent means "keep the stored value"; seller-hub owns that rule, so the body is forwarded as is.
export const AmazonSettingsSchema = z.strictObject({
  aws_region: field,
  sqs_queue_url: field,
  lwa_client_id: field,
  aws_access_key_id: field,
  aws_secret_access_key: field,
  lwa_client_secret: field,
})
export type AmazonSettingsSchema = z.infer<typeof AmazonSettingsSchema>

export const amazonSettingsMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/amazon-settings",
    method: "POST",
    middlewares: [validateAndTransformBody(AmazonSettingsSchema)],
  },
  {
    matcher: "/admin/amazon-settings/test",
    method: "POST",
    middlewares: [validateAndTransformBody(AmazonSettingsSchema)],
  },
]
