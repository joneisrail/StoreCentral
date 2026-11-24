import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { respond } from "../../marketplace-connections/respond"
import { callSellerHub } from "../../marketplace-connections/seller-hub-client"
import type { AmazonSettingsSchema } from "../middlewares"

// Tests the submitted values (blank keeps the stored ones); the body is never logged or echoed.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? {}) as AmazonSettingsSchema
  await respond(res, () =>
    callSellerHub("POST", "/internal/amazon-settings/test", body, { timeoutMs: 15_000 })
  )
}
