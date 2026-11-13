import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SaveConnectionSchema } from "../middlewares"
import { connectionPath, nonBlank, respond } from "../respond"
import { callSellerHub } from "../seller-hub-client"

// Edit: forwards as PUT (the admin API only has POST). A 422 test_failed from
// seller-hub is passed through unchanged. No workflow: nothing in the Medusa
// database is written, the state lives in seller-hub.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? {}) as SaveConnectionSchema
  await respond(res, () =>
    callSellerHub("PUT", connectionPath(req.params.id), nonBlank(body), { timeoutMs: 120_000 })
  )
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () => callSellerHub("DELETE", connectionPath(req.params.id)))
}
