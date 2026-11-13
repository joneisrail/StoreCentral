import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import type { Queue } from "bullmq"
import { Job } from "bullmq"
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
    expect.objectContaining({
      jobId: "shopify-order-450789469",
      removeOnComplete: true,
      removeOnFail: true,
    })
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
    expect.objectContaining({
      jobId: "shopify-order-77",
      removeOnComplete: true,
      removeOnFail: true,
    })
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
  const id: string = calls[0][2].jobId
  expect(id).toMatch(/^shopify-order-\d+$/)
  expect(String(parseInt(id, 10))).not.toBe(id)
  // Exercise BullMQ's real id validation (no Redis needed).
  const validate = (opts: object) =>
    (Job.prototype as any).validateOptions.call(
      { opts, name: "orders/create" },
      {}
    )
  expect(() => validate(calls[0][2])).not.toThrow()
  expect(() => validate({ jobId: "450789469" })).toThrow(/integers/)
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

// ---- WooCommerce webhook route + Medusa fan-out ----

const makeWoo = () => ({
  webhookSecret: SECRET,
  orderQueue: { add: vi.fn() } as unknown as Queue,
  inventoryQueue: { add: vi.fn() } as unknown as Queue,
  priceQueue: { add: vi.fn() } as unknown as Queue,
})

const startWooServer = (
  woocommerce?: ReturnType<typeof makeWoo>,
  shopify?: ReturnType<typeof makeShopify>
) => {
  const amazon = {
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  }
  const server = createWebhookServer({ ...amazon, shopify, woocommerce })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  return { server, amazon, url: `http://localhost:${port}` }
}

const postWoo = (
  url: string,
  topic: string,
  body: string,
  sig: string | undefined = signBody(body),
  contentType = "application/json"
) =>
  fetch(`${url}/webhooks/woocommerce`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-WC-Webhook-Topic": topic,
      ...(sig === undefined ? {} : { "X-WC-Webhook-Signature": sig }),
    },
    body,
  })

test("POST /webhooks/woocommerce with a bad signature returns 401 and queues nothing", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  const body = JSON.stringify({ id: 5 })
  expect((await postWoo(url, "order.created", body, "bogus")).status).toBe(401)
  expect((await fetch(`${url}/webhooks/woocommerce`, { method: "POST", body })).status).toBe(401)
  expect(woo.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/woocommerce with a bad signature and malformed JSON is 401, not 400", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  const res = await postWoo(url, "order.created", "{not json", "bogus")
  expect(res.status).toBe(401)
  expect(woo.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/woocommerce order.created queues one job keyed by the order id", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  const res = await postWoo(url, "order.created", JSON.stringify({ id: 727 }))
  expect(res.status).toBe(200)
  expect(woo.orderQueue.add).toHaveBeenCalledTimes(1)
  expect(woo.orderQueue.add).toHaveBeenCalledWith(
    "order.created",
    { wooOrderId: "727" },
    { jobId: "woocommerce-order-727", removeOnComplete: true, removeOnFail: true }
  )
  server.close()
})

test("POST /webhooks/woocommerce handles order.updated and order.restored", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  await postWoo(url, "order.updated", JSON.stringify({ id: 1 }))
  await postWoo(url, "order.restored", JSON.stringify({ id: 2 }))
  expect(woo.orderQueue.add).toHaveBeenCalledTimes(2)
  server.close()
})

test("POST /webhooks/woocommerce the same delivery twice uses the same job id", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  const body = JSON.stringify({ id: 5 })
  await postWoo(url, "order.created", body)
  await postWoo(url, "order.created", body)
  const calls = (woo.orderQueue.add as any).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][2].jobId).toBe(calls[1][2].jobId)
  const id: string = calls[0][2].jobId
  expect(id).toMatch(/^woocommerce-order-\d+$/)
  expect(String(parseInt(id, 10))).not.toBe(id)
  const validate = (opts: object) =>
    (Job.prototype as any).validateOptions.call(
      { opts, name: "order.created" },
      {}
    )
  expect(() => validate(calls[0][2])).not.toThrow()
  expect(() => validate({ jobId: "727" })).toThrow(/integers/)
  server.close()
})

test("POST /webhooks/woocommerce signed form-encoded ping returns 200 and queues nothing", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  const res = await postWoo(
    url,
    "",
    "webhook_id=3",
    signBody("webhook_id=3"),
    "application/x-www-form-urlencoded"
  )
  expect(res.status).toBe(200)
  expect(woo.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/woocommerce unknown topic returns 200 and queues nothing", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  const res = await postWoo(url, "product.updated", JSON.stringify({ id: 5 }))
  expect(res.status).toBe(200)
  expect(woo.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/woocommerce signed order body without a usable id is 400", async () => {
  const woo = makeWoo()
  const { server, url } = startWooServer(woo)
  expect((await postWoo(url, "order.created", JSON.stringify({ id: "abc" }))).status).toBe(400)
  expect((await postWoo(url, "order.created", JSON.stringify({}))).status).toBe(400)
  expect((await postWoo(url, "order.created", "null")).status).toBe(400)
  expect(woo.orderQueue.add).not.toHaveBeenCalled()
  server.close()
})

test("POST /webhooks/woocommerce returns 500 when the order enqueue fails", async () => {
  const woo = makeWoo()
  ;(woo.orderQueue.add as any).mockRejectedValue(new Error("redis down"))
  const { server, url } = startWooServer(woo)
  const res = await postWoo(url, "order.created", JSON.stringify({ id: 9 }))
  expect(res.status).toBe(500)
  server.close()
})

test("POST /webhooks/woocommerce is 404 when woocommerce deps are absent", async () => {
  const { server, url } = startWooServer()
  const res = await postWoo(url, "order.created", "{}")
  expect(res.status).toBe(404)
  server.close()
})

test("Medusa events fan out to Amazon, Shopify and WooCommerce queues", async () => {
  const shopify = makeShopify()
  const woo = makeWoo()
  const { server, amazon, url } = startWooServer(woo, shopify)
  const send = (event: string, id: string) =>
    fetch(`${url}/webhooks/medusa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data: { id } }),
    })
  expect((await send("inventory-level.updated", "ilev_1")).status).toBe(200)
  expect((await send("product-variant.updated", "v1")).status).toBe(200)
  const inv = ["inventory-level.updated", { inventoryLevelId: "ilev_1" }] as const
  const price = ["product-variant.updated", { variantId: "v1" }] as const
  expect(amazon.inventoryQueue.add).toHaveBeenCalledWith(...inv)
  expect(shopify.inventoryQueue.add).toHaveBeenCalledWith(...inv)
  expect(woo.inventoryQueue.add).toHaveBeenCalledWith(...inv)
  expect(amazon.priceQueue.add).toHaveBeenCalledWith(...price)
  expect(shopify.priceQueue.add).toHaveBeenCalledWith(...price)
  expect(woo.priceQueue.add).toHaveBeenCalledWith(...price)
  server.close()
})

test("a rejecting WooCommerce queue does not stop the others or change the 200", async () => {
  const shopify = makeShopify()
  const woo = makeWoo()
  ;(woo.inventoryQueue.add as any).mockRejectedValue(new Error("redis down"))
  const { server, amazon, url } = startWooServer(woo, shopify)
  const res = await fetch(`${url}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "inventory-level.updated", data: { id: "ilev_1" } }),
  })
  expect(res.status).toBe(200)
  expect(amazon.inventoryQueue.add).toHaveBeenCalledTimes(1)
  expect(shopify.inventoryQueue.add).toHaveBeenCalledTimes(1)
  server.close()
})

// ---- Per-request dep resolution + internal handler ----

const startDynamicServer = (opts: {
  shopify?: () => ReturnType<typeof makeShopify> | null
  woocommerce?: () => ReturnType<typeof makeWoo> | null
  internalHandler?: (req: any, res: any) => void | Promise<void>
}) => {
  const amazon = {
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  }
  const server = createWebhookServer({ ...amazon, ...opts })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  return { server, amazon, url: `http://localhost:${port}` }
}

test("getter returning deps behaves like the object form", async () => {
  const shopify = makeShopify()
  const woo = makeWoo()
  const { server, url } = startDynamicServer({
    shopify: () => shopify,
    woocommerce: () => woo,
  })
  expect((await postShopify(url, "orders/create", JSON.stringify({ id: 9 }))).status).toBe(200)
  expect(shopify.orderQueue.add).toHaveBeenCalledTimes(1)
  expect((await postWoo(url, "order.created", JSON.stringify({ id: 9 }))).status).toBe(200)
  expect(woo.orderQueue.add).toHaveBeenCalledTimes(1)
  server.close()
})

test("getter returning null gives 503 on order routes and unchanged 200 on medusa", async () => {
  const { server, amazon, url } = startDynamicServer({
    shopify: () => null,
    woocommerce: () => null,
  })
  expect((await postShopify(url, "orders/create", JSON.stringify({ id: 9 }))).status).toBe(503)
  expect((await postWoo(url, "order.created", JSON.stringify({ id: 9 }))).status).toBe(503)
  const res = await fetch(`${url}/webhooks/medusa`, {
    method: "POST",
    body: JSON.stringify({ event: "inventory-level.updated", data: { id: "il_1" } }),
  })
  expect(res.status).toBe(200)
  expect(amazon.inventoryQueue.add).toHaveBeenCalledTimes(1)
  server.close()
})

test("swapping the getter value between requests changes which queue receives the order", async () => {
  const a = makeShopify()
  const b = makeShopify()
  let current = a
  const { server, url } = startDynamicServer({ shopify: () => current })
  await postShopify(url, "orders/create", JSON.stringify({ id: 1 }))
  current = b
  await postShopify(url, "orders/create", JSON.stringify({ id: 2 }))
  expect(a.orderQueue.add).toHaveBeenCalledTimes(1)
  expect(b.orderQueue.add).toHaveBeenCalledTimes(1)
  server.close()
})

test("medusa fan-out uses the getter's current value per request", async () => {
  const a = makeShopify()
  let current: ReturnType<typeof makeShopify> | null = a
  const { server, url } = startDynamicServer({ shopify: () => current })
  const send = () =>
    fetch(`${url}/webhooks/medusa`, {
      method: "POST",
      body: JSON.stringify({ event: "inventory-level.updated", data: { id: "il_1" } }),
    })
  expect((await send()).status).toBe(200)
  current = null
  expect((await send()).status).toBe(200)
  expect(a.inventoryQueue.add).toHaveBeenCalledTimes(1)
  server.close()
})

test("/internal/* goes to internalHandler when supplied, 404 otherwise", async () => {
  const handler = vi.fn((_req: any, res: any) => {
    res.writeHead(204).end()
  })
  const withHandler = startDynamicServer({ internalHandler: handler })
  expect((await fetch(`${withHandler.url}/internal/anything`)).status).toBe(204)
  expect(handler).toHaveBeenCalledTimes(1)
  withHandler.server.close()

  const without = startDynamicServer({})
  expect((await fetch(`${without.url}/internal/anything`)).status).toBe(404)
  without.server.close()
})

test("a throwing or rejecting internalHandler yields 500 without crashing", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  const sync = startDynamicServer({
    internalHandler: () => {
      throw new Error("boom")
    },
  })
  expect((await fetch(`${sync.url}/internal/x`)).status).toBe(500)
  sync.server.close()

  const async_ = startDynamicServer({
    internalHandler: async () => {
      throw new Error("boom")
    },
  })
  expect((await fetch(`${async_.url}/internal/x`)).status).toBe(500)
  expect((await fetch(`${async_.url}/internal/x`)).status).toBe(500)
  async_.server.close()
  err.mockRestore()
})
