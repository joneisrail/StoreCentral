import http from "node:http"
import type { Queue } from "bullmq"

export type CreateWebhookServerDeps = {
  inventoryQueue: Queue
  priceQueue: Queue
}

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
  const { inventoryQueue, priceQueue } = deps

  return http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/webhooks/medusa") {
      res.writeHead(404).end()
      return
    }

    let rawBody = ""
    req.on("data", (chunk) => {
      rawBody += chunk
    })

    req.on("end", () => {
      void handleRequestBody(rawBody, res, { inventoryQueue, priceQueue })
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
