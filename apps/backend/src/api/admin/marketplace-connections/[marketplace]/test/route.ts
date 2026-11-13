import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { withMarketplace } from "../../respond"
import { callSellerHub } from "../../seller-hub-client"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await withMarketplace(req, res, (m) =>
    callSellerHub("POST", `/internal/connections/${m}/test`)
  )
}
