import { PermanentSyncError } from "../queue/queues.js"

export type WooCommerceClientConfig = {
  siteUrl: string
  consumerKey: string
  consumerSecret: string
  /** Defaults to global fetch; tests inject a fake. */
  fetchImpl?: typeof fetch
  /** Defaults to a real timer; tests inject a no-op. */
  sleep?: (ms: number) => Promise<void>
}

// Initial attempt plus up to 4 throttle retries.
const MAX_ATTEMPTS = 5
const DEFAULT_THROTTLE_WAIT_MS = 1000
const MAX_THROTTLE_WAIT_MS = 30_000

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Minimal WooCommerce REST v3 client (HTTP Basic auth over https). A 429 waits
 * Retry-After (capped) and retries a bounded number of times. Other 4xx are
 * permanent; 5xx and network errors are plain (retryable) errors. The consumer
 * key and secret are never included in error messages.
 */
export class WooCommerceClient {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(config: WooCommerceClientConfig) {
    const siteUrl = config.siteUrl.trim()
    if (!siteUrl.toLowerCase().startsWith("https://")) {
      throw new Error("WooCommerce site URL must start with https://")
    }
    this.baseUrl = `${siteUrl.replace(/\/+$/, "")}/wp-json/wc/v3`
    this.authHeader = `Basic ${Buffer.from(
      `${config.consumerKey}:${config.consumerSecret}`
    ).toString("base64")}`
    this.fetchImpl = config.fetchImpl ?? fetch
    this.sleep = config.sleep ?? defaultSleep
  }

  async request<T>(
    method: "GET" | "PUT" | "POST",
    path: string,
    opts: {
      query?: Record<string, string | number>
      body?: unknown
    } = {}
  ): Promise<{ data: T; totalPages: number }> {
    let url = `${this.baseUrl}${path}`
    if (opts.query) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(opts.query)) params.set(k, String(v))
      url += `?${params.toString()}`
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    }
    const init: RequestInit = { method, headers }
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json"
      init.body = JSON.stringify(opts.body)
    }

    let attempt = 0
    while (true) {
      attempt += 1
      const response = await this.fetchImpl(url, init)

      if (response.ok) {
        const data = (await response.json()) as T
        const pages = Number(response.headers.get("X-WP-TotalPages"))
        return {
          data,
          totalPages: Number.isInteger(pages) && pages >= 1 ? pages : 1,
        }
      }

      if (response.status !== 429) {
        const detail = `WooCommerce request failed with status ${response.status}`
        if (response.status >= 400 && response.status < 500) {
          throw new PermanentSyncError(detail)
        }
        throw new Error(detail)
      }

      if (attempt >= MAX_ATTEMPTS) {
        throw new Error("WooCommerce request still throttled after retries")
      }
      const waitMs = retryAfterMs(response.headers) ?? DEFAULT_THROTTLE_WAIT_MS
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
