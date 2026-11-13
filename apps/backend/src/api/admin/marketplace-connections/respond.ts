import type { MedusaResponse } from "@medusajs/framework/http"
import { SellerHubError } from "./seller-hub-client"
import type { SellerHubResult } from "./seller-hub-client"

// Answers with seller-hub's status and body, or with the mapped error.
export async function respond(
  res: MedusaResponse,
  call: () => Promise<SellerHubResult>
): Promise<void> {
  try {
    const { status, body } = await call()
    res.status(status).json(body)
  } catch (err) {
    if (err instanceof SellerHubError) {
      res.status(err.status).json({ error: "seller_hub_unavailable", message: err.message })
      return
    }
    // Not logged or echoed: the message could embed submitted values.
    res.status(500).json({ error: "internal_error", message: "Unexpected error" })
  }
}

// Drops blank strings so seller-hub keeps stored secrets.
export function nonBlank(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => typeof v === "string" && v !== "")
  ) as Record<string, string>
}

export const connectionPath = (id: unknown, action?: string): string =>
  `/internal/connections/${encodeURIComponent(String(id))}${action ? `/${action}` : ""}`
