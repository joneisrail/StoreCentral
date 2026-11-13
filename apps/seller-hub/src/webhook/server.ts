import http from "node:http"
import type { Queue } from "bullmq"
import { verifyShopifyHmac } from "../shopify/webhook.js"

export type ShopifyWebhookDeps = {
  webhookSecret: string
  orderQueue: Queue
  inventoryQueue: Queue
  priceQueue: Queue
}

export type CreateWebhookServerDeps = {
  inventoryQueue: Queue
  priceQueue: Queue
  /** When present, enables `POST /webhooks/shopify` and the Medusa fan-out. */
  shopify?: ShopifyWebhookDeps
}

const SHOPIFY_ORDER_TOPICS = new Set([
  "orders/create",
  "orders/paid",
  "orders/cancelled",
])

type MedusaWebhookBody = {
  event: string
  data: { id: string }
}

/**
 * Plain `node:http` server exposing `POST /webhooks/medusa` (matches this
 * repo's existing `apps/pos/server.js` convention -- no new HTTP framework
 * dependency). Receives the event Medusa's `seller-hub-sync` subscriber
 * (`apps/backend/src/subscribers/seller-hub-sync.ts`) forwards whenever
 * Medusa's own inventory or price state changes, and enqueues the
 * corresponding BullMQ job so Task 8's push-workers eventually sync that
 * change to Amazon.
 *
 * Event name prefixes routed here were confirmed empirically against a
 * real running Medusa backend (Task 9 Step 1) -- see
 * `apps/backend/src/subscribers/seller-hub-sync.ts` for the two confirmed
 * literal event name constants.
 */
export const createWebhookServer = (
  deps: CreateWebhookServerDeps
): http.Server => {
  const { inventoryQueue, priceQueue, shopify } = deps

  return http.createServer((req, res) => {
    if (shopify && req.method === "POST" && req.url === "/webhooks/shopify") {
      // Raw Buffer chunks: the HMAC must cover the exact bytes Shopify sent.
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })
      req.on("end", () => {
        void handleShopifyRequest(
          Buffer.concat(chunks),
          req.headers,
          res,
          shopify
        )
      })
      return
    }

    if (req.method !== "POST" || req.url !== "/webhooks/medusa") {
      res.writeHead(404).end()
      return
    }

    let rawBody = ""
    req.on("data", (chunk) => {
      rawBody += chunk
    })

    req.on("end", () => {
      void handleRequestBody(rawBody, res, { inventoryQueue, priceQueue, shopify })
    })
  })
}

/**
 * Parses and validates a raw request body, then routes it, responding
 * `400`/`200` as appropriate. Pulled out of the `req.on("end", ...)`
 * handler so it can be `async` and `await` `routeEvent`'s queue writes --
 * without that, a rejecting `Queue#add()` call (e.g. Redis unreachable)
 * would become an unhandled promise rejection and crash the process,
 * exactly the hazard this file exists to avoid.
 */
const handleRequestBody = async (
  rawBody: string,
  res: http.ServerResponse,
  queues: CreateWebhookServerDeps
): Promise<void> => {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    respondBadRequest(res, "Malformed JSON body")
    return
  }

  // `JSON.parse` happily accepts `null`, `42`, `"a string"`, `[1,2]`, etc. --
  // all valid JSON, none of them an object we can read `.event`/`.data` off
  // of without throwing.
  if (typeof body !== "object" || body === null) {
    respondBadRequest(res, "Request body must be a JSON object")
    return
  }

  const webhookBody = body as MedusaWebhookBody

  if (typeof webhookBody.event !== "string" || !webhookBody.event) {
    respondBadRequest(res, "Missing required field: event")
    return
  }
  if (typeof webhookBody.data?.id !== "string" || !webhookBody.data.id) {
    respondBadRequest(res, "Missing required field: data.id")
    return
  }

  try {
    await routeEvent(webhookBody, queues)
  } catch (err) {
    // A failure to enqueue (e.g. Redis unreachable) must not crash this
    // process -- log it and still ack the webhook so Medusa doesn't retry a
    // request whose only problem is seller-hub's own queue.
    console.error(
      `[webhook] failed to enqueue job for event "${webhookBody.event}":`,
      err
    )
  }

  // Fan out to Shopify independently of (and after) the Amazon enqueue; a
  // failure here is logged only and never changes the response.
  if (queues.shopify) {
    try {
      await routeShopifyEvent(webhookBody, queues.shopify)
    } catch (err) {
      console.error(
        `[webhook] failed to enqueue Shopify job for event "${webhookBody.event}":`,
        err
      )
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({ received: true })
  )
}

const routeShopifyEvent = async (
  body: MedusaWebhookBody,
  shopify: ShopifyWebhookDeps
): Promise<void> => {
  const { event, data } = body
  if (event.startsWith(INVENTORY_EVENT_PREFIX)) {
    await shopify.inventoryQueue.add(event, { inventoryLevelId: data.id })
  } else if (event.startsWith(PRICE_EVENT_PREFIX)) {
    await shopify.priceQueue.add(event, { variantId: data.id })
  }
}

/**
 * Handles `POST /webhooks/shopify`. The HMAC is verified over the raw bytes
 * BEFORE any JSON parsing or queueing. Order jobs carry the order's GraphQL
 * id (`gid://shopify/Order/<n>`), the form `fetchShopifyOrder` expects; the
 * BullMQ job id is the bare numeric id (BullMQ custom ids may not contain
 * ":"), so duplicate deliveries of the same order collapse into one job.
 */
const handleShopifyRequest = async (
  rawBody: Buffer,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse,
  shopify: ShopifyWebhookDeps
): Promise<void> => {
  const signature = headers["x-shopify-hmac-sha256"]
  if (
    !verifyShopifyHmac(
      rawBody,
      Array.isArray(signature) ? signature[0] : signature,
      shopify.webhookSecret
    )
  ) {
    res.writeHead(401).end()
    return
  }

  const topicHeader = headers["x-shopify-topic"]
  const topic = Array.isArray(topicHeader) ? topicHeader[0] : topicHeader
  if (!topic || !SHOPIFY_ORDER_TOPICS.has(topic)) {
    console.log(`[webhook] ignoring Shopify topic "${topic ?? ""}"`)
    res.writeHead(200).end()
    return
  }

  let payload: { id?: unknown; admin_graphql_api_id?: unknown }
  try {
    payload = JSON.parse(rawBody.toString("utf8"))
  } catch {
    respondBadRequest(res, "Malformed JSON body")
    return
  }
  if (typeof payload !== "object" || payload === null) {
    respondBadRequest(res, "Request body must be a JSON object")
    return
  }

  const gidPrefix = "gid://shopify/Order/"
  let numericId: string | undefined
  if (
    typeof payload.admin_graphql_api_id === "string" &&
    payload.admin_graphql_api_id.startsWith(gidPrefix)
  ) {
    numericId = payload.admin_graphql_api_id.slice(gidPrefix.length)
  } else if (
    typeof payload.id === "number" ||
    (typeof payload.id === "string" && payload.id)
  ) {
    numericId = String(payload.id)
  }
  if (!numericId) {
    respondBadRequest(res, "Missing required field: id")
    return
  }

  try {
    await shopify.orderQueue.add(
      topic,
      { shopifyOrderId: `${gidPrefix}${numericId}` },
      { jobId: numericId }
    )
  } catch (err) {
    // Non-2xx makes Shopify retry the delivery, which is what we want here.
    console.error(`[webhook] failed to enqueue Shopify order ${numericId}:`, err)
    res.writeHead(500).end()
    return
  }

  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({ received: true })
  )
}

// Confirmed empirically against a real running Medusa backend (Task 9
// Step 1 -- see `apps/backend/src/subscribers/seller-hub-sync.ts` for how
// these are observed and forwarded):
// - Updating an inventory level's stocked quantity via
//   `POST /admin/inventory-items/{id}/location-levels/{location_id}` fires
//   "inventory-level.updated" with `data: { id: <inventory_level_id> }`.
// - Updating a variant's price via
//   `POST /admin/products/{id}/variants/{variant_id}` (the admin
//   dashboard's own "edit price" flow) fires "product-variant.updated"
//   with `data: { id: <variant_id> }` -- not a dedicated "price.*" or
//   "price-list.*" event, since a direct variant price edit doesn't go
//   through the price-list module.
const INVENTORY_EVENT_PREFIX = "inventory-level."
const PRICE_EVENT_PREFIX = "product-variant."

/**
 * Routes a validated webhook body to the matching BullMQ queue based on its
 * event name prefix. An event name that matches neither prefix is a
 * forward-compatible no-op (ignored, not an error) -- see `createWebhookServer`'s
 * doc comment.
 */
const routeEvent = async (
  body: MedusaWebhookBody,
  queues: CreateWebhookServerDeps
): Promise<void> => {
  const { event, data } = body

  if (event.startsWith(INVENTORY_EVENT_PREFIX)) {
    console.log(`[webhook] received "${event}" -- enqueuing inventory sync`)
    await queues.inventoryQueue.add(event, { inventoryLevelId: data.id })
    return
  }

  if (event.startsWith(PRICE_EVENT_PREFIX)) {
    console.log(`[webhook] received "${event}" -- enqueuing price sync`)
    await queues.priceQueue.add(event, { variantId: data.id })
    return
  }

  console.log(`[webhook] ignoring unrecognized event "${event}"`)
}

const respondBadRequest = (res: http.ServerResponse, message: string): void => {
  res.writeHead(400, { "Content-Type": "application/json" }).end(
    JSON.stringify({ error: message })
  )
}
