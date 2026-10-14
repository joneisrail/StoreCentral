export type TokenBucketOptions = {
  /** Tokens added per second. */
  ratePerSecond: number
  /** Maximum number of tokens the bucket can hold. */
  burst: number
}

export type TokenBucket = {
  /**
   * Resolves once a token has been consumed. Resolves immediately when a token
   * is available, otherwise waits until the bucket has refilled enough.
   */
  take(): Promise<void>
}

/**
 * Creates a token bucket that starts full at `burst` tokens and refills at
 * `ratePerSecond`, never holding more than `burst` tokens.
 */
export function createTokenBucket(options: TokenBucketOptions): TokenBucket {
  const { ratePerSecond, burst } = options

  let tokens = burst
  let lastRefillAt = Date.now()

  const refill = () => {
    const now = Date.now()
    const elapsedSeconds = (now - lastRefillAt) / 1000
    tokens = Math.min(burst, tokens + elapsedSeconds * ratePerSecond)
    lastRefillAt = now
  }

  const take = async (): Promise<void> => {
    while (true) {
      refill()
      if (tokens >= 1) {
        tokens -= 1
        return
      }
      const waitMs = Math.ceil(((1 - tokens) / ratePerSecond) * 1000)
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
    }
  }

  return { take }
}
