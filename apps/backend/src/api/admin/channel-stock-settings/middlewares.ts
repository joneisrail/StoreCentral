import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const UpdateChannelStockSettingsSchema = z.strictObject({
  share_stock_after_sale: z.boolean(),
})
export type UpdateChannelStockSettingsSchema = z.infer<typeof UpdateChannelStockSettingsSchema>

export const channelStockSettingsMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/channel-stock-settings",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateChannelStockSettingsSchema)],
  },
]
