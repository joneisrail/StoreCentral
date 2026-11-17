import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SaveConnectionSchema } from "../middlewares"
import { connectionPath, nonBlank, respond } from "../respond"
import { callSellerHub } from "../seller-hub-client"

// Edit: forwards as PUT (the admin API only has POST). A 422 test_failed from
// seller-hub is passed through unchanged. No workflow: nothing in the Medusa
// database is written, the state lives in seller-hub.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { auto_sync_price, ...credentials } = (req.validatedBody ?? {}) as SaveConnectionSchema
  // nonBlank drops everything but non-empty strings, so the boolean flag is forwarded explicitly
  // (false included).
  const creds = nonBlank(credentials)
  const flag = typeof auto_sync_price === "boolean" ? { auto_sync_price } : {}
  // A flag-only save never tests or restarts the connection, so it needs no long timeout.
  const credentialSave = Object.keys(creds).length > 0 || Object.keys(flag).length === 0
  await respond(res, () =>
    callSellerHub(
      "PUT",
      connectionPath(req.params.id),
      { ...creds, ...flag },
      credentialSave ? { timeoutMs: 120_000 } : undefined
    )
  )
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () => callSellerHub("DELETE", connectionPath(req.params.id)))
}
