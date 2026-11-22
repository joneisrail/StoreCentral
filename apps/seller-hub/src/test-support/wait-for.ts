/**
 * Polls `condition` until it returns true, replacing fixed sleeps in tests.
 * Rejects with "waitFor timed out ..." after `timeoutMs` instead of hanging,
 * and with the condition's own error if it throws. Async conditions are
 * awaited. Its timer is always cleared, so it never keeps the process alive.
 */
export const waitFor = (
  condition: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> => {
  const timeoutMs = opts.timeoutMs ?? 5000
  const intervalMs = opts.intervalMs ?? 10
  const deadline = Date.now() + timeoutMs

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = async () => {
      timer = undefined
      try {
        if (await condition()) {
          resolve()
          return
        }
      } catch (err) {
        reject(err)
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`))
        return
      }
      timer = setTimeout(check, intervalMs)
    }

    void check()
  })
}
