import http from "node:http"
import type { Queue } from "bullmq"
import { verifyShopifyHmac } from "../shopify/webhook.js"
import { verifyWooSignature } from "../woocommerce/webhook.js"

export type ShopifyWebhookDeps = {
  webhookSecret: string
  orderQueue: Queue
  inventoryQueue: Queue
  priceQueue: Queue
}

export type WooCommerceWebhookDeps = {
  webhookSecret: string
  orderQueue: Queue
  inventoryQueue: Queue
  priceQueue: Queue
}

export type WebhookMarketplace = "shopify" | "woocommerce"

/** Per-connection webhook lookup. Wins over the single-deps `shopify`/`woocommerce` options. */
export type WebhookRegistry = {
  /** With an id: that live connection. Without: the legacy live one, else the oldest managed one. null = not live. */
  get(
    marketplace: WebhookMarketplace,
    accountId?: string
  ): ShopifyWebhookDeps | WooCommerceWebhookDeps | null
  /** Every live connection of the marketplace (Medusa fan-out). */
  all(marketplace: WebhookMarketplace): Array<ShopifyWebhookDeps | WooCommerceWebhookDeps>
  /** Optional: true when the id is a known connection that is merely not live (503 rather than 404). */
  known?(marketplace: WebhookMarketplace, accountId: string): boolean
}

export type CreateWebhookServerDeps = {
  inventoryQueue: Queue
  priceQueue: Queue
  /** When present, enables `POST /webhooks/shopify` and the Medusa fan-out. */
  shopify?: ShopifyWebhookDeps | (() => ShopifyWebhookDeps | null)
  /** When present, enables `POST /webhooks/woocommerce` and the WooCommerce Medusa fan-out. */
  woocommerce?: WooCommerceWebhookDeps | (() => WooCommerceWebhookDeps | null)
  /** Enables per-connection routes `/webhooks/<marketplace>/<id>` and the multi-connection Medusa fan-out. */
  connectors?: WebhookRegistry
  /** Owns the response for any request whose URL starts with `/internal/`. */
  internalHandler?: (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => void | Promise<void>
}

/** Resolves a deps object or getter; null means "configured but not live". */
const resolveDeps = <T>(x: T | (() => T | null) | undefined): T | null => {
  try {
    return typeof x === "function" ? (x as () => T | null)() : (x ?? null)
  } catch (err) {
    // A throwing getter is treated as "not live"; log only the error class.
    console.error(
      "[seller-hub] webhook deps getter threw:",
      err instanceof Error ? err.constructor.name : typeof err
    )
    return null
  }
}

const WOO_ORDER_TOPICS = new Set([
  "order.created",
  "order.updated",
  "order.restored",
])

const SHOPIFY_ORDER_TOPICS = new Set([
  "orders/create",
  "orders/paid",
  "orders/cancelled",
])

type ResolvedQueues = {
  inventoryQueue: Queue
  priceQueue: Queue
  shopify: ShopifyWebhookDeps[]
  woocommerce: WooCommerceWebhookDeps[]
}

const errName = (err: unknown): string =>
  err instanceof Error ? err.constructor.name : typeof err

/** Runs a registry call; a throwing registry is treated as "not live" (class name only is logged). */
const safeRegistry = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch (err) {
    console.error("[seller-hub] webhook registry threw:", errName(err))
    return fallback
  }
}

/** `/webhooks/<marketplace>[/<id>]`, ignoring any query string; ids match exactly. */
const parseWebhookPath = (
  url: string | undefined
): { marketplace: WebhookMarketplace; accountId?: string } | null => {
  const path = (url ?? "").split("?")[0]
  const m = /^\/webhooks\/(shopify|woocommerce)(?:\/([^/]+))?$/.exec(path)
  if (!m) return null
  return { marketplace: m[1] as WebhookMarketplace, accountId: m[2] }
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
  const { inventoryQueue, priceQueue, internalHandler } = deps

  const unavailable = (req: http.IncomingMessage, res: http.ServerResponse) => {
    req.resume()
    res.writeHead(503).end()
  }

  return http.createServer((req, res) => {
    if (req.url?.startsWith("/internal/")) {
      if (!internalHandler) {
        res.writeHead(404).end()
        return
      }
      const fail = (err: unknown) => {
        console.error("[webhook] internal handler failed:", err)
        if (!res.headersSent) {
          res.writeHead(500).end()
        } else {
          res.end()
        }
      }
      try {
        void Promise.resolve(internalHandler(req, res)).catch(fail)
      } catch (err) {
        fail(err)
      }
      return
    }

    const route = req.method === "POST" ? parseWebhookPath(req.url) : null
    const registry = deps.connectors

    if (route) {
      const { marketplace, accountId } = route
      // The registry owns both marketplaces' routes; otherwise only configured ones exist.
      const configured = registry ? true : Boolean(deps[marketplace])
      if (configured) {
        let order: ShopifyWebhookDeps | WooCommerceWebhookDeps | null
        if (registry) {
          let threw = false
          try {
            order = registry.get(marketplace, accountId)
          } catch (err) {
            threw = true
            order = null
            console.error("[seller-hub] webhook registry threw:", errName(err))
          }
          if (!order) {
            // Unknown id -> 404; a known-but-stopped id, no live legacy/oldest
            // runtime, or a throwing registry -> 503.
            const known =
              accountId !== undefined && safeRegistry(() => registry.known?.(marketplace, accountId) ?? false, false)
            if (accountId !== undefined && !known && !threw) {
              req.resume()
              res.writeHead(404).end()
              return
            }
            unavailable(req, res)
            return
          }
        } else if (accountId !== undefined) {
          req.resume()
          res.writeHead(404).end()
          return
        } else {
          order = resolveDeps(deps[marketplace])
          if (!order) {
            unavailable(req, res)
            return
          }
        }
        // Raw Buffer chunks: the HMAC must cover the exact bytes the marketplace sent.
        const chunks: Buffer[] = []
        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk)
        })
        const handler = marketplace === "shopify" ? handleShopifyRequest : handleWooCommerceRequest
        const target = order
        req.on("end", () => {
          void handler(Buffer.concat(chunks), req.headers, res, target)
        })
        return
      }
    }

    if (req.method !== "POST" || req.url?.split("?")[0] !== "/webhooks/medusa") {
      res.writeHead(404).end()
      return
    }

    // Resolve once per request so a live connector swap takes effect immediately.
    const fan = (marketplace: WebhookMarketplace) =>
      registry
        ? safeRegistry(() => registry.all(marketplace), [])
        : [resolveDeps(deps[marketplace])].filter((d) => d !== null)
    const shopify = fan("shopify") as ShopifyWebhookDeps[]
    const woocommerce = fan("woocommerce") as WooCommerceWebhookDeps[]

    let rawBody = ""
    req.on("data", (chunk) => {
      rawBody += chunk
    })

    req.on("end", () => {
      void handleRequestBody(rawBody, res, {
        inventoryQueue,
        priceQueue,
        shopify,
        woocommerce,
      })
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
  queues: ResolvedQueues
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

  // Fan out to every live connection independently of (and after) the Amazon
  // enqueue; a failure on one is logged (event + class name only) and isolated.
  for (const [label, targets, route] of [
    ["Shopify", queues.shopify, routeShopifyEvent],
    ["WooCommerce", queues.woocommerce, routeWooCommerceEvent],
  ] as const) {
    for (const target of targets) {
      try {
        await route(webhookBody, target)
      } catch (err) {
        console.error(
          `[webhook] failed to enqueue ${label} job for event "${webhookBody.event}" (${errName(err)})`
        )
      }
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({ received: true })
  )
}

const routeWooCommerceEvent = async (
  body: MedusaWebhookBody,
  woo: WooCommerceWebhookDeps
): Promise<void> => {
  const { event, data } = body
  if (event.startsWith(INVENTORY_EVENT_PREFIX)) {
    await woo.inventoryQueue.add(event, { inventoryLevelId: data.id })
  } else if (event.startsWith(PRICE_EVENT_PREFIX)) {
    await woo.priceQueue.add(event, { variantId: data.id })
  }
}

/**
 * Handles `POST /webhooks/woocommerce`. The HMAC is verified over the raw
 * bytes BEFORE any JSON parsing or queueing. WooCommerce's creation "ping" is
 * a signed form-encoded body (`webhook_id=...`); it is acknowledged with 200
 * and nothing is queued, as are non-order topics (WooCommerce disables a
 * webhook after repeated non-2xx replies). Only a genuine enqueue failure
 * returns 500 so WooCommerce retries. Job id is `woocommerce-order-<id>`
 * (BullMQ rejects integer-only ids).
 */
const handleWooCommerceRequest = async (
  rawBody: Buffer,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse,
  woo: WooCommerceWebhookDeps
): Promise<void> => {
  const signature = headers["x-wc-webhook-signature"]
  if (
    !verifyWooSignature(
      rawBody,
      Array.isArray(signature) ? signature[0] : signature,
      woo.webhookSecret
    )
  ) {
    res.writeHead(401).end()
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString("utf8"))
  } catch {
    // Signed but not JSON: the form-encoded creation ping. Acknowledge.
    res.writeHead(200).end()
    return
  }

  const topicHeader = headers["x-wc-webhook-topic"]
  const topic = Array.isArray(topicHeader) ? topicHeader[0] : topicHeader
  if (!topic || !WOO_ORDER_TOPICS.has(topic)) {
    console.log(
      `[webhook] ignoring WooCommerce topic "${(topic ?? "").slice(0, 64)}"`
    )
    res.writeHead(200).end()
    return
  }

  const id =
    typeof payload === "object" && payload !== null
      ? (payload as { id?: unknown }).id
      : undefined
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    respondBadRequest(res, "Missing required field: id")
    return
  }

  try {
    await woo.orderQueue.add(
      topic,
      { wooOrderId: String(id) },
      {
        // BullMQ rejects purely numeric custom ids, so prefix it.
        jobId: `woocommerce-order-${id}`,
        // Dedup only while in flight; the import is idempotent via sync_job.
        removeOnComplete: true,
        removeOnFail: true,
      }
    )
  } catch (err) {
    // Non-2xx makes WooCommerce retry the delivery, which is what we want here.
    console.error(`[webhook] failed to enqueue WooCommerce order ${id}:`, err)
    res.writeHead(500).end()
    return
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
 * BullMQ job id is `shopify-order-<n>` (BullMQ rejects integer-only ids), so duplicate deliveries of the same order collapse into one job.
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
    console.log(`[webhook] ignoring Shopify topic "${(topic ?? "").slice(0, 64)}"`)
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
      {
        // BullMQ rejects purely numeric custom ids, so prefix it.
        jobId: `shopify-order-${numericId}`,
        // Dedup only while in flight: a finished/failed job must not block a
        // later topic (paid/cancelled) for the same order. The import is
        // idempotent via sync_job.
        removeOnComplete: true,
        removeOnFail: true,
      }
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
  queues: ResolvedQueues
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
