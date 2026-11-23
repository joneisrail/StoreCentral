import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { connectionPath, respond } from "../../respond"
import { callSellerHub } from "../../seller-hub-client"
import type { ImportSchema } from "../../middlewares"

export async function POST(req: MedusaRequest<ImportSchema>, res: MedusaResponse) {
  await respond(res, () =>
    callSellerHub("POST", connectionPath(req.params.id, "import"), req.validatedBody, { timeoutMs: 300_000 })
  )
}
