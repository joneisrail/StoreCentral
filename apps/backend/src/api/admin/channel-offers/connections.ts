import { callSellerHub, SellerHubError } from "../marketplace-connections/seller-hub-client"

const HUB_TIMEOUT_MS = 4000

// Sales channels with a seller-hub connection, or a SellerHubError when
// seller-hub cannot answer (not configured, unreachable, rejected secret,
// non-200, odd body). Nothing is logged: errors carry fixed messages only.
export async function fetchConnectedChannelIds(): Promise<Set<string>> {
  const { status, body } = await callSellerHub("GET", "/internal/connections", undefined, {
    timeoutMs: HUB_TIMEOUT_MS,
  })
  if (status !== 200 || !Array.isArray(body?.connections)) {
    throw new SellerHubError(502, "Cannot read marketplace connections from seller-hub")
  }
  return new Set(
    body.connections
      .filter((c: any) => c && typeof c.sales_channel_id === "string" && c.status !== "disconnected")
      .map((c: any) => c.sales_channel_id as string)
  )
}

// Read-model variant: any failure means "none", so the grid still answers.
export async function connectedChannelIds(): Promise<Set<string>> {
  try {
    return await fetchConnectedChannelIds()
  } catch {
    return new Set()
  }
}
