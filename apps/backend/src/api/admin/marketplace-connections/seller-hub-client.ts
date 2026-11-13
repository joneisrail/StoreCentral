const TIMEOUT_MS = 15_000

export type SellerHubMethod = "GET" | "PUT" | "POST" | "DELETE"

export type SellerHubResult = { status: number; body: any }

// An error with the HTTP status the admin API should answer with. Messages are
// fixed strings: never the secret, request bodies or upstream error text.
export class SellerHubError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "SellerHubError"
  }
}

// Calls seller-hub's internal API. 2xx and ordinary 4xx/5xx replies come back as
// `{ status, body }` (so callers can pass them through); misconfiguration,
// network failure and a rejected secret throw a SellerHubError. Nothing here
// logs request bodies, the secret or response bodies.
export async function callSellerHub(
  method: SellerHubMethod,
  path: string,
  body?: unknown,
  opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}
): Promise<SellerHubResult> {
  const env = opts.env ?? process.env
  const fetchImpl = opts.fetchImpl ?? fetch
  const baseUrl = env.SELLER_HUB_INTERNAL_URL?.trim().replace(/\/+$/, "")
  const secret = env.SELLER_HUB_INTERNAL_SECRET?.trim()
  if (!baseUrl || !secret) {
    throw new SellerHubError(503, "Marketplace connections are not configured")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let status: number
  let text: string
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    status = response.status
    text = await response.text()
  } catch {
    throw new SellerHubError(502, "Cannot reach seller-hub")
  } finally {
    clearTimeout(timer)
  }

  if (status === 401) {
    throw new SellerHubError(502, "seller-hub rejected the shared secret")
  }

  let parsed: any = {}
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = {}
    }
  }
  return { status, body: parsed }
}
