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

// ---- Shopify webhook route + Medusa fan-out ----
import crypto from "node:crypto"

const SECRET = "whsec_test"
const signBody = (body: string) =>
  crypto.createHmac("sha256", SECRET).update(body).digest("base64")

const makeShopify = () => ({
  webhookSecret: SECRET,
  orderQueue: { add: vi.fn() } as unknown as Queue,
  inventoryQueue: { add: vi.fn() } as unknown as Queue,
  priceQueue: { add: vi.fn() } as unknown as Queue,
})

const startServer = (shopify?: ReturnType<typeof makeShopify>) => {
  const amazon = {
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  }
  const server = createWebhookServer({ ...amazon, shopify })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  return { server, amazon, url: `http://localhost:${port}` }
}

const postShopify = (
  url: string,
  topic: string,
  body: string,
  sig = signBody(body)
) =>
  fetch(`${url}/webhooks/shopify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Hmac-Sha256": sig,
    },
    body,
  })

test("POST /webhooks/shopify with a bad signature returns 401 and queues nothing", async () => {
  const shopify = makeShopify()
  const { server, url } = startServer(shopify)
  const res = await postShopify(url, "orders/create", '{"id":1}', "bad")
  expect(res.status).toBe(401)
  expect(shopify.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/shopify with a bad signature and malformed JSON is 401, not 400", async () => {
  const shopify = makeShopify()
  const { server, url } = startServer(shopify)
  const res = await postShopify(url, "orders/create", "not json", "bad")
  expect(res.status).toBe(401)
  server.close()
})

test("POST /webhooks/shopify orders/create queues one job keyed by the order id", async () => {
  const shopify = makeShopify()
  const { server, url } = startServer(shopify)
  const body = JSON.stringify({ id: 450789469, admin_graphql_api_id: "gid://shopify/Order/450789469" })
  const res = await postShopify(url, "orders/create", body)
  expect(res.status).toBe(200)
  expect(shopify.orderQueue.add).toHaveBeenCalledTimes(1)
  expect(shopify.orderQueue.add).toHaveBeenCalledWith(
    "orders/create",
    { shopifyOrderId: "gid://shopify/Order/450789469" },
    expect.objectContaining({ jobId: "450789469" })
  )
  server.close()
})

test("POST /webhooks/shopify builds the GID from a numeric id when no GID is present", async () => {
  const shopify = makeShopify()
  const { server, url } = startServer(shopify)
  const res = await postShopify(url, "orders/paid", JSON.stringify({ id: 77 }))
  expect(res.status).toBe(200)
  expect(shopify.orderQueue.add).toHaveBeenCalledWith(
    "orders/paid",
    { shopifyOrderId: "gid://shopify/Order/77" },
    expect.objectContaining({ jobId: "77" })
  )
  server.close()
})

test("POST /webhooks/shopify the same delivery twice uses the same job id", async () => {
  const shopify = makeShopify()
  const { server, url } = startServer(shopify)
  const body = JSON.stringify({ id: 5 })
  await postShopify(url, "orders/create", body)
  await postShopify(url, "orders/create", body)
  const calls = (shopify.orderQueue.add as any).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][2].jobId).toBe(calls[1][2].jobId)
  server.close()
})

test("POST /webhooks/shopify with an unknown topic returns 200 and queues nothing", async () => {
  const shopify = makeShopify()
  const { server, url } = startServer(shopify)
  const res = await postShopify(url, "products/update", JSON.stringify({ id: 5 }))
  expect(res.status).toBe(200)
  expect(shopify.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/shopify is 404 when shopify deps are absent", async () => {
  const { server, url } = startServer()
  const res = await postShopify(url, "orders/create", "{}")
  expect(res.status).toBe(404)
  server.close()
})

test("Medusa inventory event fans out to Amazon and Shopify inventory queues", async () => {
  const shopify = makeShopify()
  const { server, amazon, url } = startServer(shopify)
  const res = await fetch(`${url}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "inventory-level.updated", data: { id: "ilev_1" } }),
  })
  expect(res.status).toBe(200)
  expect(amazon.inventoryQueue.add).toHaveBeenCalledWith("inventory-level.updated", { inventoryLevelId: "ilev_1" })
  expect(shopify.inventoryQueue.add).toHaveBeenCalledWith("inventory-level.updated", { inventoryLevelId: "ilev_1" })
  server.close()
})

test("Medusa price event fans out to Amazon and Shopify price queues", async () => {
  const shopify = makeShopify()
  const { server, amazon, url } = startServer(shopify)
  await fetch(`${url}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "product-variant.updated", data: { id: "v1" } }),
  })
  expect(amazon.priceQueue.add).toHaveBeenCalledWith("product-variant.updated", { variantId: "v1" })
  expect(shopify.priceQueue.add).toHaveBeenCalledWith("product-variant.updated", { variantId: "v1" })
  server.close()
})

test("a rejecting Shopify queue does not stop the Amazon enqueue or change the 200", async () => {
  const shopify = makeShopify()
  ;(shopify.inventoryQueue.add as any).mockRejectedValue(new Error("redis down"))
  const { server, amazon, url } = startServer(shopify)
  const res = await fetch(`${url}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "inventory-level.updated", data: { id: "ilev_1" } }),
  })
  expect(res.status).toBe(200)
  expect(amazon.inventoryQueue.add).toHaveBeenCalledTimes(1)
  server.close()
})
