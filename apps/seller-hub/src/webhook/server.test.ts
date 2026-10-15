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
