import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SellerHubError } from "./seller-hub-client"
import type { SellerHubResult } from "./seller-hub-client"

const WRITABLE = ["shopify", "woocommerce"]

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

// Runs `call` for a shopify/woocommerce marketplace; amazon (read-only) and
// anything else is a 400.
export async function withMarketplace(
  req: MedusaRequest,
  res: MedusaResponse,
  call: (marketplace: string) => Promise<SellerHubResult>
): Promise<void> {
  const marketplace = String((req.params as Record<string, string>).marketplace)
  if (!WRITABLE.includes(marketplace)) {
    res.status(400).json({
      error: "not_supported",
      message: "This marketplace cannot be managed here",
    })
    return
  }
  await respond(res, () => call(marketplace))
}
