import type http from "node:http"
import type { Pool } from "pg"
import {
  ConnectionInputError,
  clearConnection,
  listConnectionRows,
  mergeShopifyInput,
  mergeWooInput,
  resolveShopifyConfig,
  resolveWooConfig,
  saveConnection,
  setConnectionStatus,
  type ConfigSource,
  type ConnectionRow,
  type Marketplace,
  type ShopifyInput,
  type WooInput,
} from "../connectors/credentials.js"
import type { ConnectorManager } from "../connectors/manager.js"
import { testShopifyConnection, testWooCommerceConnection } from "../connectors/test-connection.js"
import type { ShopifyConfig } from "../shopify/config.js"
import { loadShopifyConfig } from "../shopify/config.js"
import type { WooCommerceConfig } from "../woocommerce/config.js"
import { loadWooCommerceConfig } from "../woocommerce/config.js"
import { isAuthorized } from "./auth.js"

export type InternalHandlerDeps = {
  pool: Pool
  manager: ConnectorManager
  encryptionKey: string
  secret: string
  publicUrl?: string
  env?: NodeJS.ProcessEnv
  testShopify?: typeof testShopifyConnection
  testWoo?: typeof testWooCommerceConnection
}

const MAX_BODY_BYTES = 64 * 1024
const LISTED = ["shopify", "woocommerce", "amazon"] as const
const BODY_KEYS = [
  "shop_domain",
  "access_token",
  "webhook_secret",
  "location_id",
  "site_url",
  "consumer_key",
  "consumer_secret",
  "sales_channel_id",
] as const

class UnreadableError extends Error {}
class BodyError extends Error {
  constructor(readonly status: number) {
    super("body")
  }
}

const send = (res: http.ServerResponse, status: number, body?: unknown): void => {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  })
  res.end(text)
}

const readJsonBody = (req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      req.off("data", onData)
      fn()
    }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish(() => {
          req.pause()
          res.once("close", () => req.destroy())
          reject(new BodyError(413))
        })
        return
      }
      chunks.push(chunk)
    }
    req.on("data", onData)
    req.once("end", () =>
      finish(() => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            reject(new BodyError(400))
          } else resolve(parsed)
        } catch {
          reject(new BodyError(400))
        }
      })
    )
    req.once("error", () => finish(() => reject(new BodyError(400))))
  })

const resolveStored = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch {
    throw new UnreadableError()
  }
}

export const createInternalHandler = (deps: InternalHandlerDeps) => {
  const env = deps.env ?? process.env
  const testShopify = deps.testShopify ?? testShopifyConnection
  const testWoo = deps.testWoo ?? testWooCommerceConnection
  const base = (deps.publicUrl ?? "").replace(/\/+$/, "")

  const webhookUrl = (m: string): string => `${base}/webhooks/${m}`

  const storedShopify = () =>
    resolveStored(() => resolveShopifyConfig(deps.pool, deps.encryptionKey, env))
  const storedWoo = () => resolveStored(() => resolveWooConfig(deps.pool, deps.encryptionKey, env))

  const view = (
    marketplace: (typeof LISTED)[number],
    row: ConnectionRow | undefined,
    source: ConfigSource,
    fields: Record<string, unknown>
  ) => ({
    marketplace,
    status: row?.status ?? "disconnected",
    last_error: row?.lastError ?? null,
    last_synced_at: row?.lastSyncedAt ?? null,
    linked_listings: row?.linkedListings ?? 0,
    sales_channel_id: row?.salesChannelId ?? null,
    credentials_source: source,
    read_only: marketplace === "amazon",
    fields,
    webhook_url: webhookUrl(marketplace),
  })

  const shopifyFields = (c: ShopifyConfig | undefined) =>
    c ? { shop_domain: c.shopDomain, location_id: c.locationId } : {}
  const wooFields = (c: WooCommerceConfig | undefined) =>
    c ? { site_url: c.siteUrl, consumer_key_set: Boolean(c.consumerKey) } : {}

  const connectionView = async (marketplace: Marketplace) => {
    const rows = await listConnectionRows(deps.pool)
    const row = rows.find((r) => r.marketplace === marketplace)
    if (marketplace === "shopify") {
      const r = await storedShopify()
      return view("shopify", row, r?.source ?? "none", shopifyFields(r?.config))
    }
    const r = await storedWoo()
    return view("woocommerce", row, r?.source ?? "none", wooFields(r?.config))
  }

  const list = async (res: http.ServerResponse) => {
    const rows = await listConnectionRows(deps.pool)
    const find = (m: string) => rows.find((r) => r.marketplace === m)
    const s = await storedShopify()
    const w = await storedWoo()
    send(res, 200, {
      connections: [
        view("shopify", find("shopify"), s?.source ?? "none", shopifyFields(s?.config)),
        view("woocommerce", find("woocommerce"), w?.source ?? "none", wooFields(w?.config)),
        view("amazon", find("amazon"), "environment", {}),
      ],
    })
  }

  const stringKeys = (body: Record<string, unknown>): Record<string, string | undefined> | null => {
    const out: Record<string, string | undefined> = {}
    for (const k of BODY_KEYS) {
      const v = body[k]
      if (v === undefined) continue
      if (typeof v !== "string") return null
      out[k] = v
    }
    return out
  }

  const put = async (
    marketplace: Marketplace,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    const raw = (await readJsonBody(req, res)) as Record<string, unknown>
    const b = stringKeys(raw)
    if (!b) return send(res, 400, { error: "invalid_input", fields: [] })
    const salesChannelId = b.sales_channel_id?.trim() || undefined

    let config: ShopifyConfig | WooCommerceConfig
    try {
      if (marketplace === "shopify") {
        const stored = await storedShopify()
        const input: ShopifyInput = {
          shopDomain: b.shop_domain,
          accessToken: b.access_token,
          webhookSecret: b.webhook_secret,
          locationId: b.location_id,
        }
        config = mergeShopifyInput(stored?.config ?? null, input)
      } else {
        const stored = await storedWoo()
        const input: WooInput = {
          siteUrl: b.site_url,
          consumerKey: b.consumer_key,
          consumerSecret: b.consumer_secret,
          webhookSecret: b.webhook_secret,
        }
        config = mergeWooInput(stored?.config ?? null, input)
      }
    } catch (err) {
      if (err instanceof ConnectionInputError) {
        return send(res, 400, { error: "invalid_input", fields: err.fields })
      }
      throw err
    }

    const result =
      marketplace === "shopify"
        ? await testShopify(config as ShopifyConfig)
        : await testWoo(config as WooCommerceConfig)
    if (!result.ok) return send(res, 422, { error: "test_failed", message: result.message })

    await saveConnection(deps.pool, deps.encryptionKey, marketplace, config, salesChannelId)
    const applied = await deps.manager.apply(marketplace)
    const connection = await connectionView(marketplace)
    if (applied.error) return send(res, 200, { ok: false, error: applied.error, connection })
    send(res, 200, { ok: true, connection })
  }

  const testStored = async (marketplace: Marketplace, res: http.ServerResponse) => {
    let result
    if (marketplace === "shopify") {
      const stored = await storedShopify()
      if (!stored) return send(res, 409, { error: "not_configured" })
      result = await testShopify(stored.config)
    } else {
      const stored = await storedWoo()
      if (!stored) return send(res, 409, { error: "not_configured" })
      result = await testWoo(stored.config)
    }
    if (!result.ok) {
      await setConnectionStatus(deps.pool, marketplace, "error", result.message)
    } else {
      // Only mark connected when a runtime is actually live; otherwise the badge
      // would claim a sync that is not running.
      const live =
        marketplace === "shopify" ? deps.manager.getShopify() : deps.manager.getWooCommerce()
      if (live) await setConnectionStatus(deps.pool, marketplace, "connected", null)
    }
    send(res, 200, result)
  }

  const link = async (marketplace: Marketplace, res: http.ServerResponse) => {
    const runtime =
      marketplace === "shopify" ? deps.manager.getShopify() : deps.manager.getWooCommerce()
    if (!runtime) return send(res, 409, { error: "not_running" })
    const r = await runtime.relink()
    send(res, 200, {
      linked: r.linked,
      already_linked: r.alreadyLinked,
      unmatched: r.unmatched.length,
      duplicates: r.duplicates.length,
    })
  }

  const remove = async (marketplace: Marketplace, res: http.ServerResponse) => {
    await deps.manager.stop(marketplace)
    await clearConnection(deps.pool, marketplace)
    const fallback = marketplace === "shopify" ? loadShopifyConfig(env) : loadWooCommerceConfig(env)
    send(res, 200, { ok: true, env_fallback: fallback !== null })
  }

  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parts: string[]
  ): Promise<void> => {
    const method = req.method ?? "GET"
    // parts: ["internal", "connections", marketplace?, action?]
    if (parts[0] !== "internal" || parts[1] !== "connections" || parts.length > 4) {
      return send(res, 404, { error: "not_found" })
    }
    if (parts.length === 2) {
      if (method !== "GET") return send(res, 405, { error: "method_not_allowed" })
      return list(res)
    }
    const name = parts[2]!
    const action = parts[3]
    if (!(LISTED as readonly string[]).includes(name)) return send(res, 404, { error: "not_found" })
    if (action !== undefined && action !== "test" && action !== "link") {
      return send(res, 404, { error: "not_found" })
    }
    const expected = action === undefined ? ["PUT", "DELETE"] : ["POST"]
    if (!expected.includes(method)) return send(res, 405, { error: "method_not_allowed" })
    if (name === "amazon") return send(res, 400, { error: "not_supported" })
    const marketplace = name as Marketplace
    if (action === "test") return testStored(marketplace, res)
    if (action === "link") return link(marketplace, res)
    if (method === "PUT") return put(marketplace, req, res)
    return remove(marketplace, res)
  }

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!isAuthorized(req.headers.authorization, deps.secret)) {
      send(res, 401)
      return
    }
    try {
      const path = new URL(req.url ?? "/", "http://x").pathname
      const parts = path.split("/").filter(Boolean)
      await route(req, res, parts)
    } catch (err) {
      if (res.headersSent) return
      if (err instanceof BodyError) {
        return send(res, err.status, { error: err.status === 413 ? "payload_too_large" : "invalid_json" })
      }
      if (err instanceof UnreadableError) {
        return send(res, 500, { error: "stored_credentials_unreadable" })
      }
      // Never log err.message: it may embed submitted or stored values.
      console.error(`[seller-hub] internal API error (${err instanceof Error ? err.constructor.name : typeof err})`)
      send(res, 500, { error: "internal_error" })
    }
  }
}
