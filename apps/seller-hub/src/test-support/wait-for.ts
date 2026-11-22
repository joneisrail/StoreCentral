/**
 * Polls `condition` until it returns true, replacing fixed sleeps in tests.
 * Rejects with "waitFor timed out ..." after `timeoutMs` even if the
 * condition itself never settles, and with the condition's own error if it
 * throws. Async conditions are awaited. Both the deadline timer and the poll
 * timer are cleared on every exit path, so it never keeps the process alive.
 */
export const waitFor = (
  condition: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> => {
  const timeoutMs = opts.timeoutMs ?? 5000
  const intervalMs = opts.intervalMs ?? 10

  return new Promise<void>((resolve, reject) => {
    let done = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (fn: () => void) => {
      done = true
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
      fn()
    }

    deadlineTimer = setTimeout(() => {
      finish(() => reject(new Error(`waitFor timed out after ${timeoutMs}ms`)))
    }, timeoutMs)

    const check = async () => {
      pollTimer = undefined
      if (done) return
      try {
        const ok = await condition()
        if (done) return
        if (ok) {
          finish(resolve)
          return
        }
      } catch (err) {
        if (done) return
        finish(() => reject(err))
        return
      }
      pollTimer = setTimeout(check, intervalMs)
    }

    void check()
  })
}
