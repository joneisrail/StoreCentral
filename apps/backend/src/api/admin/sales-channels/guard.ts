import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { callSellerHub } from "../marketplace-connections/seller-hub-client"

export const DELETE_BLOCKED_MESSAGE =
  "Disconnect the marketplace before deleting this sales channel"

// Blocks deleting a sales channel that still has a marketplace connection (any
// status). When seller-hub cannot be asked the delete is allowed, so an outage
// never makes a channel undeletable.
export async function guardSalesChannelDelete(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  let linked = false
  try {
    const { status, body } = await callSellerHub("GET", "/internal/connections")
    linked =
      status === 200 &&
      Array.isArray(body?.connections) &&
      body.connections.some((c: any) => c?.sales_channel_id === req.params.id)
  } catch {
    linked = false
  }
  if (linked) {
    res.status(400).json({ type: "not_allowed", message: DELETE_BLOCKED_MESSAGE })
    return
  }
  next()
}
