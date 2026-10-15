import type { AddressInfo } from "node:net"
import type { Queue } from "bullmq"
import { expect, test, vi } from "vitest"
import { createWebhookServer } from "./server.js"

test("POST /webhooks/medusa with an inventory event enqueues an inventory-sync job", async () => {
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const server = createWebhookServer({ inventoryQueue, priceQueue })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "inventory-level.updated",
      data: { id: "ilev_123" },
    }),
  })
  expect(res.status).toBe(200)
  expect(inventoryQueue.add).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ inventoryLevelId: "ilev_123" })
  )
  server.close()
})

test("POST /webhooks/medusa with a price event enqueues a price-sync job", async () => {
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const server = createWebhookServer({ inventoryQueue, priceQueue })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "product-variant.updated",
      data: { id: "variant_123" },
    }),
  })
  expect(res.status).toBe(200)
  expect(priceQueue.add).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ variantId: "variant_123" })
  )
  expect(inventoryQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/medusa with an unrecognized event is ignored (200, no-op)", async () => {
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const server = createWebhookServer({ inventoryQueue, priceQueue })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "order.placed", data: { id: "order_123" } }),
  })
  expect(res.status).toBe(200)
  expect(inventoryQueue.add).not.toHaveBeenCalled()
  expect(priceQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/medusa with a malformed body returns 400 and does not crash", async () => {
  const server = createWebhookServer({
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  })
  expect(res.status).toBe(400)
  server.close()
})

test("POST /webhooks/medusa with a JSON body of literal null returns 400 and does not crash", async () => {
  const server = createWebhookServer({
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  })
  server.listen(0)
  const port = (server.address() as AddressInfo).port

  // `JSON.parse("null")` succeeds and returns `null` -- a valid JSON body
  // that isn't an object. Reading `.event` off it must not throw.
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  })
  expect(res.status).toBe(400)

  // Prove the server (and process) is still alive and responsive, not
  // crashed by an uncaught exception from the request above.
  const followUp = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "order.placed", data: { id: "order_123" } }),
  })
  expect(followUp.status).toBe(200)

  server.close()
})

test("POST /webhooks/medusa still responds 200, with no unhandled rejection, when the matching queue's add() rejects (e.g. Redis unreachable)", async () => {
  // Deliberately a plain function returning a real rejected `Promise`, not
  // `vi.fn().mockRejectedValue(...)` -- Vitest's mock-settlement tracking
  // (`mock.results`/`mock.settledResults`) attaches its own internal
  // `.then`/`.catch` to a mocked async return value to record how it
  // settled, which itself "handles" the rejection from Node's perspective
  // and would mask exactly the bug this test exists to catch.
  let addCalls = 0
  const inventoryQueue = {
    add: (..._args: unknown[]) => {
      addCalls++
      return Promise.reject(new Error("ECONNREFUSED"))
    },
  } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const server = createWebhookServer({ inventoryQueue, priceQueue })
  server.listen(0)
  const port = (server.address() as AddressInfo).port

  // A rejecting `Queue#add()` that isn't `await`ed/`.catch()`-ed inside the
  // request handler surfaces as an `unhandledRejection` on `process`, not as
  // a thrown error the response's own try/catch would see -- so this is the
  // signal that actually distinguishes the buggy code from the fix.
  const unhandledRejections: unknown[] = []
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason)
  }
  process.on("unhandledRejection", onUnhandledRejection)

  try {
    const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "inventory-level.updated",
        data: { id: "ilev_123" },
      }),
    })
    // The webhook still acks -- a rejecting queue write must not crash the
    // process or leave the request hanging/erroring.
    expect(res.status).toBe(200)

    // Give the rejected promise's microtask queue a chance to surface an
    // unhandled-rejection event before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(unhandledRejections).toHaveLength(0)
    expect(addCalls).toBe(1)

    // Prove the server (and process) is still alive and responsive after
    // the rejection.
    const followUp = await fetch(`http://localhost:${port}/webhooks/medusa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "order.placed",
        data: { id: "order_123" },
      }),
    })
    expect(followUp.status).toBe(200)
  } finally {
    process.off("unhandledRejection", onUnhandledRejection)
    server.close()
  }
})

test("POST /webhooks/medusa missing event or data.id returns 400", async () => {
  const server = createWebhookServer({
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  })
  server.listen(0)
  const port = (server.address() as AddressInfo).port

  const missingEvent = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "ilev_123" } }),
  })
  expect(missingEvent.status).toBe(400)

  const missingDataId = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "inventory-level.updated", data: {} }),
  })
  expect(missingDataId.status).toBe(400)

  server.close()
})
