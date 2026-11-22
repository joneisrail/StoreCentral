import type { AddressInfo } from "node:net"
import type { Queue } from "bullmq"
import { afterEach, expect, test, vi } from "vitest"
import { checkHealth } from "./health.js"
import { createWebhookServer } from "./server.js"

const servers: Array<{ close: () => void }> = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  vi.restoreAllMocks()
})

test("checkHealth is ok when both probes resolve", async () => {
  const result = await checkHealth({
    postgres: async () => {},
    redis: async () => {},
  })
  expect(result).toEqual({ ok: true })
})

test("checkHealth is not ok when postgres rejects", async () => {
  const result = await checkHealth({
    postgres: async () => {
      throw new Error("connection refused")
    },
    redis: async () => {},
  })
  expect(result).toEqual({ ok: false })
})

test("checkHealth is not ok when redis rejects", async () => {
  const result = await checkHealth({
    postgres: async () => {},
    redis: async () => {
      throw new Error("down")
    },
  })
  expect(result).toEqual({ ok: false })
})

test("checkHealth is not ok when a probe exceeds the timeout", async () => {
  const started = Date.now()
  const result = await checkHealth(
    { postgres: async () => {}, redis: () => new Promise<void>(() => {}) },
    50
  )
  expect(result).toEqual({ ok: false })
  expect(Date.now() - started).toBeLessThan(1000)
})

const start = (health?: () => Promise<{ ok: boolean }>) => {
  const server = createWebhookServer({
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
    ...(health ? { health } : {}),
  })
  server.listen(0)
  servers.push(server)
  return `http://localhost:${(server.address() as AddressInfo).port}`
}

test("GET /health answers 200 with exactly the ok body", async () => {
  const base = start(async () => ({ ok: true }))
  const res = await fetch(`${base}/health`)
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("application/json")
  expect(await res.text()).toBe('{"status":"ok"}')
})

test("GET /health answers 503 with exactly the unavailable body", async () => {
  const base = start(async () => ({ ok: false }))
  const res = await fetch(`${base}/health`)
  expect(res.status).toBe(503)
  expect(res.headers.get("content-type")).toContain("application/json")
  expect(await res.text()).toBe('{"status":"unavailable"}')
})

test("GET /health answers 503 without leaking the error when the probe throws", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const base = start(async () => {
    throw new Error("secret-host:5432 refused")
  })
  const res = await fetch(`${base}/health`)
  const text = await res.text()
  expect(res.status).toBe(503)
  expect(text).toBe('{"status":"unavailable"}')
  expect(text).not.toContain("secret-host")
})

test("GET /health answers 503 when no health dependency is configured", async () => {
  const base = start()
  const res = await fetch(`${base}/health`)
  expect(res.status).toBe(503)
  expect(await res.text()).toBe('{"status":"unavailable"}')
})

test("POST /health is not a health route", async () => {
  const health = vi.fn(async () => ({ ok: true }))
  const base = start(health)
  const res = await fetch(`${base}/health`, { method: "POST", body: "{}" })
  expect(res.status).not.toBe(200)
  expect(health).not.toHaveBeenCalled()
})
