import { PermanentSyncError } from "../queue/queues.js"

/** Pinned Shopify Admin API version (a stable quarterly release). */
export const SHOPIFY_API_VERSION = "2025-10"

export type ShopifyClientConfig = {
  shopDomain: string
  accessToken: string
  apiVersion?: string
  /** Defaults to global fetch; tests inject a fake. */
  fetchImpl?: typeof fetch
  /** Defaults to a real timer; tests inject a no-op. */
  sleep?: (ms: number) => Promise<void>
}

// Initial attempt plus up to 4 throttle retries.
const MAX_ATTEMPTS = 5
const DEFAULT_THROTTLE_WAIT_MS = 1000
const MAX_THROTTLE_WAIT_MS = 30_000

type GraphQlError = { message?: string; extensions?: { code?: string } }
type GraphQlResponse<T> = {
  data?: T
  errors?: GraphQlError[]
  extensions?: {
    cost?: {
      requestedQueryCost?: number
      throttleStatus?: { currentlyAvailable?: number; restoreRate?: number }
    }
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Minimal Shopify Admin GraphQL client. Throttling (HTTP 429 or a THROTTLED
 * GraphQL error) waits the server's hint and retries a bounded number of
 * times. Other 4xx and GraphQL errors are permanent; 5xx and network errors
 * are plain (retryable) errors. The access token is never logged or included
 * in error messages.
 */
export class ShopifyClient {
  private readonly shopDomain: string
  private readonly accessToken: string
  private readonly apiVersion: string
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(config: ShopifyClientConfig) {
    this.shopDomain = config.shopDomain
    this.accessToken = config.accessToken
    this.apiVersion = config.apiVersion ?? SHOPIFY_API_VERSION
    this.fetchImpl = config.fetchImpl ?? fetch
    this.sleep = config.sleep ?? defaultSleep
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`

    let attempt = 0
    while (true) {
      attempt += 1

      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.accessToken,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      })

      let waitMs: number | null = null

      if (response.status === 429) {
        waitMs = retryAfterMs(response.headers) ?? DEFAULT_THROTTLE_WAIT_MS
      } else if (!response.ok) {
        const detail = `Shopify request failed with status ${response.status}`
        if (response.status >= 400 && response.status < 500) {
          throw new PermanentSyncError(detail)
        }
        throw new Error(detail)
      } else {
        const body = (await response.json()) as GraphQlResponse<T>
        const errors = body.errors
        if (errors && errors.length > 0) {
          if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
            waitMs = throttleHintMs(body) ?? DEFAULT_THROTTLE_WAIT_MS
          } else {
            const messages = errors.map((e) => e.message ?? "unknown").join("; ")
            throw new PermanentSyncError(`Shopify GraphQL error: ${messages}`)
          }
        } else {
          return body.data as T
        }
      }

      if (attempt >= MAX_ATTEMPTS) {
        throw new Error("Shopify request still throttled after retries")
      }
      await this.sleep(Math.min(waitMs, MAX_THROTTLE_WAIT_MS))
    }
  }
}

const retryAfterMs = (headers: Headers): number | null => {
  const value = headers.get("Retry-After")
  if (value === null) return null
  const seconds = Number(value)
  return Number.isNaN(seconds) ? null : Math.max(0, seconds * 1000)
}

/** Time for the leaky bucket to refill the shortfall, from the cost extension. */
const throttleHintMs = (body: GraphQlResponse<unknown>): number | null => {
  const cost = body.extensions?.cost
  const requested = cost?.requestedQueryCost
  const available = cost?.throttleStatus?.currentlyAvailable
  const rate = cost?.throttleStatus?.restoreRate
  if (
    typeof requested !== "number" ||
    typeof available !== "number" ||
    typeof rate !== "number" ||
    rate <= 0
  ) {
    return null
  }
  return Math.max(0, Math.ceil(((requested - available) / rate) * 1000))
}
