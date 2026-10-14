import { expect, test, vi } from "vitest"
import { createTokenBucket } from "./rate-limiter.js"

test("take() resolves immediately while tokens are available", async () => {
  const bucket = createTokenBucket({ ratePerSecond: 1, burst: 2 })
  await bucket.take()
  await bucket.take() // both within burst, should not throw or hang
})

test("take() waits for refill once the bucket is empty", async () => {
  vi.useFakeTimers()
  try {
    const bucket = createTokenBucket({ ratePerSecond: 1, burst: 1 })
    await bucket.take() // consumes the only token
    const takePromise = bucket.take()
    let resolved = false
    takePromise.then(() => (resolved = true))
    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(false) // not refilled yet at 0.5s with 1/s rate
    await vi.advanceTimersByTimeAsync(600)
    expect(resolved).toBe(true) // refilled by ~1.1s
  } finally {
    vi.useRealTimers()
  }
})
