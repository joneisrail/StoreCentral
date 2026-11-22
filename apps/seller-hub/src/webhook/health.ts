export type HealthProbes = {
  postgres: () => Promise<void>
  redis: () => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 2000

const withTimeout = (probe: () => Promise<void>, timeoutMs: number): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe timed out")), timeoutMs)
    let started: Promise<void>
    try {
      started = probe()
    } catch (err) {
      clearTimeout(timer)
      reject(err)
      return
    }
    started.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })

/**
 * Runs every dependency probe in parallel. A probe that rejects or exceeds
 * `timeoutMs` makes the result not ok. The reason is never returned.
 */
export const checkHealth = async (
  probes: HealthProbes,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ ok: boolean }> => {
  const results = await Promise.allSettled([
    withTimeout(probes.postgres, timeoutMs),
    withTimeout(probes.redis, timeoutMs),
  ])
  return { ok: results.every((r) => r.status === "fulfilled") }
}
