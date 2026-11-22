import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { waitFor } from "./wait-for.js"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test("resolves once the condition turns true", async () => {
  let ready = false
  let settled = false
  const p = waitFor(() => ready, { timeoutMs: 1000, intervalMs: 10 }).then(
    () => {
      settled = true
    }
  )

  await vi.advanceTimersByTimeAsync(50)
  expect(settled).toBe(false)

  ready = true
  await vi.advanceTimersByTimeAsync(10)
  await p
  expect(settled).toBe(true)
})

test("resolves immediately when the condition is already true", async () => {
  await expect(waitFor(() => true)).resolves.toBeUndefined()
})

test("rejects with a waitFor timed out error after timeoutMs", async () => {
  const p = waitFor(() => false, { timeoutMs: 100, intervalMs: 10 })
  const assertion = expect(p).rejects.toThrow(/^waitFor timed out/)
  await vi.advanceTimersByTimeAsync(200)
  await assertion
})

test("supports an async condition", async () => {
  let calls = 0
  const p = waitFor(
    async () => {
      calls++
      await Promise.resolve()
      return calls >= 3
    },
    { timeoutMs: 1000, intervalMs: 10 }
  )
  await vi.advanceTimersByTimeAsync(100)
  await p
  expect(calls).toBe(3)
})

test("a condition that throws rejects with that error", async () => {
  const boom = new Error("boom")
  const p = waitFor(
    () => {
      throw boom
    },
    { timeoutMs: 1000, intervalMs: 10 }
  )
  await expect(p).rejects.toBe(boom)
})

test("leaves no pending timers behind", async () => {
  let ready = false
  const p = waitFor(() => ready, { timeoutMs: 1000, intervalMs: 10 })
  await vi.advanceTimersByTimeAsync(30)
  ready = true
  await vi.advanceTimersByTimeAsync(10)
  await p
  expect(vi.getTimerCount()).toBe(0)

  await expect(
    (async () => {
      const t = waitFor(() => false, { timeoutMs: 20, intervalMs: 10 })
      const a = expect(t).rejects.toThrow("waitFor timed out")
      await vi.advanceTimersByTimeAsync(50)
      await a
    })()
  ).resolves.toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})
