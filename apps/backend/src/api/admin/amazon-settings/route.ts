import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { respond } from "../marketplace-connections/respond"
import { callSellerHub } from "../marketplace-connections/seller-hub-client"
import type { AmazonSettingsSchema } from "./middlewares"

const PATH = "/internal/amazon-settings"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () => callSellerHub("GET", PATH))
}

// The body is forwarded as validated and never logged or echoed.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? {}) as AmazonSettingsSchema
  await respond(res, () => callSellerHub("POST", PATH, body))
}

export async function DELETE(_req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () => callSellerHub("DELETE", PATH))
}
