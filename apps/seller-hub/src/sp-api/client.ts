import { refreshAccessToken } from "./auth.js"
import { createTokenBucket, type TokenBucket } from "./rate-limiter.js"

export type SpApiOperation = {
  /** e.g. "getOrder" — used as the rate-limiter bucket key. */
  name: string
  method: "GET" | "POST"
  path: string
  query?: Record<string, string>
  body?: unknown
  rateLimit: { ratePerSecond: number; burst: number }
}

export type SpApiClientConfig = {
  /** SP-API regional endpoint. */
  baseUrl: string
  refreshToken: string
  clientId: string
  clientSecret: string
  /** Defaults to global fetch; tests inject a fake. */
  fetchImpl?: typeof fetch
}

// "max 3 attempts" is read as 3 total calls to the operation endpoint: the
// initial attempt plus up to 2 retries.
const MAX_ATTEMPTS = 3
const TOKEN_EXPIRY_BUFFER_MS = 60_000

/**
 * HTTP client for Amazon's Selling Partner API. Handles LWA access-token
 * refresh/caching, per-operation rate limiting (via Task 3's token bucket),
 * and retry-with-backoff on transient (429/5xx) failures.
 */
export class SpApiClient {
  private readonly config: SpApiClientConfig
  private readonly fetchImpl: typeof fetch
  private readonly buckets = new Map<string, TokenBucket>()
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0

  constructor(config: SpApiClientConfig) {
    this.config = config
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async request<T>(operation: SpApiOperation): Promise<T> {
    const bucket = this.getBucket(operation)

    let attempt = 0
    while (true) {
      attempt += 1

      const accessToken = await this.getAccessToken()
      await bucket.take()

      const response = await this.fetchImpl(this.buildUrl(operation), {
        method: operation.method,
        headers: {
          "x-amz-access-token": accessToken,
          ...(operation.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body:
          operation.body !== undefined
            ? JSON.stringify(operation.body)
            : undefined,
      })

      if (response.ok) {
        // e.g. confirmShipment answers 204 No Content.
        if (response.status === 204) return undefined as T
        return (await response.json()) as T
      }

      const retryable = response.status === 429 || response.status >= 500

      if (!retryable || attempt >= MAX_ATTEMPTS) {
        const errorBody = await readBodySafely(response)
        throw new Error(
          `SP-API request "${operation.name}" failed with status ${response.status}: ${errorBody}`
        )
      }

      await wait(this.backoffMs(attempt, response.headers))
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (
      this.accessToken &&
      this.accessTokenExpiresAt - now > TOKEN_EXPIRY_BUFFER_MS
    ) {
      return this.accessToken
    }

    const { accessToken, expiresAt } = await refreshAccessToken(
      {
        refreshToken: this.config.refreshToken,
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      },
      this.fetchImpl
    )

    this.accessToken = accessToken
    this.accessTokenExpiresAt = expiresAt
    return accessToken
  }

  private getBucket(operation: SpApiOperation): TokenBucket {
    let bucket = this.buckets.get(operation.name)
    if (!bucket) {
      bucket = createTokenBucket(operation.rateLimit)
      this.buckets.set(operation.name, bucket)
    }
    return bucket
  }

  private buildUrl(operation: SpApiOperation): string {
    const url = new URL(operation.path, this.config.baseUrl)
    if (operation.query) {
      for (const [key, value] of Object.entries(operation.query)) {
        url.searchParams.set(key, value)
      }
    }
    return url.toString()
  }

  /**
   * Backoff before the next attempt. Prefers the `Retry-After` header
   * (seconds) when present — that's a server-dictated wait, so it is
   * honored exactly, with no jitter. Otherwise falls back to
   * `min(2**attempt * 200, 5000)` ms with +/-50% jitter (uniformly
   * randomized to 50%-100% of that value), per the plan's global
   * "exponential backoff + jitter" constraint for transient-error
   * retries. `attempt` is the number of attempts made so far (1 after
   * the first failure, 2 after the second, ...).
   */
  private backoffMs(attempt: number, headers: Headers): number {
    const retryAfter = headers.get("Retry-After")
    if (retryAfter !== null) {
      const seconds = Number(retryAfter)
      if (!Number.isNaN(seconds)) {
        return seconds * 1000
      }
    }
    const base = Math.min(2 ** attempt * 200, 5000)
    const jitterMultiplier = 0.5 + Math.random() * 0.5
    return base * jitterMultiplier
  }
}

const readBodySafely = async (response: Response): Promise<string> => {
  try {
    const body = await response.json()
    return JSON.stringify(body)
  } catch {
    return ""
  }
}

const wait = (ms: number): Promise<void> => {
  if (ms <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => setTimeout(resolve, ms))
}
