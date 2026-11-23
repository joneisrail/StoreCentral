import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { connectionPath, respond } from "../../respond"
import { callSellerHub } from "../../seller-hub-client"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () =>
    callSellerHub("GET", connectionPath(req.params.id, "import-preview"), undefined, { timeoutMs: 120_000 })
  )
}
