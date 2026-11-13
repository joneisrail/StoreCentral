import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { connectionPath, respond } from "../../respond"
import { callSellerHub } from "../../seller-hub-client"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () =>
    callSellerHub("POST", connectionPath(req.params.id, "test"), undefined, { timeoutMs: 30_000 })
  )
}
