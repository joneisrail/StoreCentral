import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { respond } from "./respond"
import { callSellerHub } from "./seller-hub-client"

// No workflow: nothing in the Medusa database is written, the state lives in seller-hub.
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  await respond(res, () => callSellerHub("GET", "/internal/connections"))
}
