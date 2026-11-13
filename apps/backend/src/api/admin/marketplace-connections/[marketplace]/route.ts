import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SaveConnectionSchema } from "../middlewares"
import { withMarketplace } from "../respond"
import { callSellerHub } from "../seller-hub-client"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? {}) as SaveConnectionSchema
  // Blank values are dropped so seller-hub keeps the stored secrets.
  const forwarded = Object.fromEntries(
    Object.entries(body).filter(([, v]) => typeof v === "string" && v !== "")
  )
  await withMarketplace(req, res, (m) =>
    callSellerHub("PUT", `/internal/connections/${m}`, forwarded)
  )
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  await withMarketplace(req, res, (m) => callSellerHub("DELETE", `/internal/connections/${m}`))
}
