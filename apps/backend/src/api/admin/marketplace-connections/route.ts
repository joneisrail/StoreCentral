import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createMarketplaceSalesChannelWorkflow } from "../../../workflows/create-marketplace-sales-channel"
import type { CreateConnectionSchema } from "./middlewares"
import { nonBlank, respond } from "./respond"
import { callSellerHub } from "./seller-hub-client"

type View = Record<string, any>
type Status = "connected" | "error" | "disconnected" | "unavailable"

const UNAVAILABLE_MESSAGE =
  "The sales channel was created, but the marketplace could not be reached. Open the sales channel and choose Connect to try again."

// Maps seller-hub's create reply to the status the admin shows.
export function deriveStatus(status: number, body: any): Status {
  if (status >= 500) return "unavailable"
  if (status !== 200) return "error"
  if (body?.ok === false) return "error"
  if (body?.input_problem === "missing") return "disconnected"
  const connection: View | null = body?.connection ?? null
  if (connection?.status === "connected") return "connected"
  if (connection?.status === "error") return "error"
  return "disconnected"
}

// Lists connections; ?sales_channel_id= narrows to one channel. No workflow:
// nothing in the Medusa database is written, the state lives in seller-hub.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const raw = (req.query as Record<string, unknown> | undefined)?.sales_channel_id
  const channelId = typeof raw === "string" && raw.trim() ? raw.trim() : undefined
  await respond(res, async () => {
    const result = await callSellerHub("GET", "/internal/connections")
    if (channelId && result.status === 200 && Array.isArray(result.body?.connections)) {
      return {
        status: 200,
        body: {
          connections: result.body.connections.filter(
            (c: View) => c?.sales_channel_id === channelId
          ),
        },
      }
    }
    return result
  })
}

// The channel is always created first and kept, whatever happens next.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { marketplace, name, sales_channel_id, description, is_disabled, ...rest } =
    (req.validatedBody ?? {}) as CreateConnectionSchema
  let channel: { id: string; name: string }
  if (sales_channel_id !== undefined) {
    // Attach to an existing channel: no workflow, just check it exists.
    let found: { id: string; name: string } | undefined
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "sales_channel",
        fields: ["id", "name"],
        filters: { id: sales_channel_id },
      })
      found = data?.[0] as { id: string; name: string } | undefined
    } catch {
      res.status(500).json({ error: "internal_error", message: "Unexpected error" })
      return
    }
    if (!found) {
      res
        .status(404)
        .json({ error: "sales_channel_not_found", message: "Sales channel not found" })
      return
    }
    channel = { id: found.id, name: found.name }
  } else {
    try {
      const { result } = await createMarketplaceSalesChannelWorkflow(req.scope).run({
        input: { name: name as string, description, is_disabled },
      })
      channel = { id: result.id, name: result.name }
    } catch {
      // Not logged or echoed: the message could embed submitted values.
      res
        .status(400)
        .json({ error: "channel_create_failed", message: "Could not create the sales channel" })
      return
    }
  }

  try {
    const { status, body } = await callSellerHub(
      "POST",
      "/internal/connections",
      { marketplace, sales_channel_id: channel.id, ...nonBlank(rest) },
      { timeoutMs: 120_000 }
    )
    if (status === 400 && Array.isArray(body?.fields) && body.fields.includes("sales_channel_id")) {
      res.status(400).json({
        error: "already_connected",
        message: "This sales channel already has a marketplace connection.",
      })
      return
    }
    const connectionStatus = deriveStatus(status, body)
    if (connectionStatus === "unavailable") {
      res.status(200).json({
        sales_channel: channel,
        connection: null,
        test: null,
        connection_status: "unavailable",
        message: UNAVAILABLE_MESSAGE,
      })
      return
    }
    const message =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : undefined
    res.status(200).json({
      sales_channel: channel,
      connection: body?.connection ?? null,
      test: body?.test ?? null,
      connection_status: connectionStatus,
      ...(message ? { message } : {}),
      ...(body?.input_problem ? { input_problem: body.input_problem } : {}),
      ...(Array.isArray(body?.fields) ? { fields: body.fields } : {}),
    })
  } catch {
    // Seller-hub down, not configured or anything else: the channel stays.
    res.status(200).json({
      sales_channel: channel,
      connection: null,
      test: null,
      connection_status: "unavailable",
      message: UNAVAILABLE_MESSAGE,
    })
  }
}
