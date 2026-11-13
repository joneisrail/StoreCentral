import type http from "node:http"
import type { Pool } from "pg"
import {
  ConnectionInputError,
  clearConnectionById,
  createConnectionRow,
  listConnectionRows,
  loadStoredConfig,
  mergeAmazonInput,
  mergeShopifyInput,
  mergeWooInput,
  resolveLegacyConfig,
  saveConnectionById,
  setStatusById,
  type AmazonConfig,
  type ConnectionRow,
  type Marketplace,
} from "../connectors/credentials.js"
import type { ConnectorManager } from "../connectors/manager.js"
import { testShopifyConnection, testWooCommerceConnection } from "../connectors/test-connection.js"
import type { ShopifyConfig } from "../shopify/config.js"
import type { WooCommerceConfig } from "../woocommerce/config.js"
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
const MARKETPLACES: readonly string[] = ["shopify", "woocommerce", "amazon"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_NAMES: Record<Marketplace, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  amazon: "Amazon",
}
const BODY_KEYS = [
  "marketplace",
  "display_name",
  "shop_domain",
  "access_token",
  "webhook_secret",
  "location_id",
  "site_url",
  "consumer_key",
  "consumer_secret",
  "seller_id",
  "marketplace_id",
  "refresh_token",
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

type Config = ShopifyConfig | WooCommerceConfig | AmazonConfig
type Input = Partial<Record<(typeof BODY_KEYS)[number], string>>
type TestOutcome = { ok: true } | { ok: false; message: string }

export const createInternalHandler = (deps: InternalHandlerDeps) => {
  const env = deps.env ?? process.env
  const testShopify = deps.testShopify ?? testShopifyConnection
  const testWoo = deps.testWoo ?? testWooCommerceConnection
  const base = (deps.publicUrl ?? "").replace(/\/+$/, "")

  const view = (row: ConnectionRow) => {
    const marketplace = row.marketplace as Marketplace
    let fields: Record<string, unknown> = {}
    if (marketplace === "shopify") {
      fields = { shop_domain: row.shopDomain, location_id: row.shopifyLocationId }
    } else if (marketplace === "woocommerce") {
      fields = { site_url: row.shopDomain, consumer_key_set: row.apiKeyPresent }
    } else if (marketplace === "amazon") {
      fields = { seller_id: row.amazonSellerId, marketplace_id: row.amazonMarketplaceId }
    }
    return {
      id: row.id,
      marketplace,
      display_name: row.displayName ?? DEFAULT_NAMES[marketplace] ?? row.marketplace,
      status: row.status,
      last_error: row.lastError,
      last_synced_at: row.lastSyncedAt,
      linked_listings: row.linkedListings,
      sales_channel_id: row.salesChannelId,
      managed: row.managed,
      read_only: !row.managed,
      credentials_source: !row.managed ? "environment" : row.hasStoredCredentials ? "database" : "none",
      // Amazon never has a runtime: saved credentials only.
      sync_live: marketplace !== "amazon" && deps.manager.get(row.id) !== null,
      fields,
      webhook_url: `${base}/webhooks/${row.marketplace}/${row.id}`,
    }
  }

  const findRow = async (id: string): Promise<ConnectionRow | undefined> =>
    (await listConnectionRows(deps.pool)).find((r) => r.id === id)

  const viewOf = async (id: string) => {
    const row = await findRow(id)
    return row ? view(row) : null
  }

  const list = async (res: http.ServerResponse) => {
    const rows = await listConnectionRows(deps.pool)
    send(res, 200, { connections: rows.map(view) })
  }

  const stringKeys = (body: Record<string, unknown>): Input | null => {
    const out: Input = {}
    for (const k of BODY_KEYS) {
      const v = body[k]
      if (v === undefined) continue
      if (typeof v !== "string") return null
      out[k] = v
    }
    return out
  }

  /** Merges submitted input over the stored config; throws ConnectionInputError when incomplete. */
  const mergeConfig = (marketplace: Marketplace, stored: Config | null, b: Input): Config => {
    if (marketplace === "shopify") {
      return mergeShopifyInput(stored as ShopifyConfig | null, {
        shopDomain: b.shop_domain,
        accessToken: b.access_token,
        webhookSecret: b.webhook_secret,
        locationId: b.location_id,
      })
    }
    if (marketplace === "woocommerce") {
      return mergeWooInput(stored as WooCommerceConfig | null, {
        siteUrl: b.site_url,
        consumerKey: b.consumer_key,
        consumerSecret: b.consumer_secret,
        webhookSecret: b.webhook_secret,
      })
    }
    return mergeAmazonInput(stored as AmazonConfig | null, {
      sellerId: b.seller_id,
      marketplaceId: b.marketplace_id,
      refreshToken: b.refresh_token,
    })
  }

  const runTest = async (marketplace: Marketplace, config: Config): Promise<TestOutcome> => {
    const r =
      marketplace === "shopify"
        ? await testShopify(config as ShopifyConfig)
        : await testWoo(config as WooCommerceConfig)
    return r.ok ? { ok: true } : { ok: false, message: r.message }
  }

  /**
   * Stores a complete config. Shopify/WooCommerce are live-tested first: a pass
   * saves and starts the connector, a fail saves with status `error` and starts
   * nothing. Amazon is stored only (no tester, no manager). `guardConnected`
   * lets an edit of a working connection bail out before anything changes.
   */
  const saveAndApply = async (
    res: http.ServerResponse,
    id: string,
    marketplace: Marketplace,
    config: Config,
    guardConnected: boolean
  ) => {
    if (marketplace === "amazon") {
      await saveConnectionById(deps.pool, deps.encryptionKey, id, config, "disconnected", null)
      return send(res, 200, { ok: true, connection: await viewOf(id), test: null })
    }
    const test = await runTest(marketplace, config)
    if (!test.ok) {
      if (guardConnected) return send(res, 422, { error: "test_failed", message: test.message })
      await saveConnectionById(deps.pool, deps.encryptionKey, id, config, "error", test.message)
      return send(res, 200, { ok: false, connection: await viewOf(id), test })
    }
    await saveConnectionById(deps.pool, deps.encryptionKey, id, config, "connected", null)
    const applied = await deps.manager.apply(id)
    const connection = await viewOf(id)
    if (applied.error) return send(res, 200, { ok: false, error: applied.error, connection, test })
    send(res, 200, { ok: true, connection, test })
  }

  const create = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const raw = (await readJsonBody(req, res)) as Record<string, unknown>
    const b = stringKeys(raw)
    if (!b) return send(res, 400, { error: "invalid_input", fields: [] })
    const marketplace = b.marketplace?.trim() ?? ""
    if (!MARKETPLACES.includes(marketplace)) {
      return send(res, 400, { error: "invalid_input", fields: ["marketplace"] })
    }
    const salesChannelId = b.sales_channel_id?.trim()
    if (!salesChannelId) return send(res, 400, { error: "invalid_input", fields: ["sales_channel_id"] })
    const kind = marketplace as Marketplace

    let id: string
    try {
      id = await createConnectionRow(deps.pool, {
        marketplace: kind,
        salesChannelId,
        displayName: b.display_name?.trim() || DEFAULT_NAMES[kind],
      })
    } catch (err) {
      if (err instanceof ConnectionInputError) {
        return send(res, 400, { error: "invalid_input", fields: err.fields })
      }
      throw err
    }

    let config: Config
    try {
      config = mergeConfig(kind, null, b)
    } catch (err) {
      // Incomplete input: the channel keeps a credential-less, disconnected row.
      if (err instanceof ConnectionInputError) {
        return send(res, 200, { ok: true, connection: await viewOf(id), test: null })
      }
      throw err
    }
    await saveAndApply(res, id, kind, config, false)
  }

  const edit = async (id: string, req: http.IncomingMessage, res: http.ServerResponse) => {
    const row = await findRow(id)
    if (!row) return send(res, 404, { error: "not_found" })
    if (!row.managed) return send(res, 400, { error: "read_only" })
    const raw = (await readJsonBody(req, res)) as Record<string, unknown>
    const b = stringKeys(raw)
    if (!b) return send(res, 400, { error: "invalid_input", fields: [] })
    const marketplace = row.marketplace as Marketplace

    const stored = await resolveStored(() => loadStoredConfig(deps.pool, deps.encryptionKey, id))
    let config: Config
    try {
      config = mergeConfig(marketplace, stored, b)
    } catch (err) {
      if (err instanceof ConnectionInputError) {
        return send(res, 400, { error: "invalid_input", fields: err.fields })
      }
      throw err
    }
    await saveAndApply(res, id, marketplace, config, row.status === "connected")
  }

  const testStored = async (id: string, res: http.ServerResponse) => {
    const row = await findRow(id)
    if (!row) return send(res, 404, { error: "not_found" })
    const marketplace = row.marketplace as Marketplace
    if (marketplace === "amazon") return send(res, 400, { error: "not_supported" })
    const stored = await resolveStored(async () =>
      row.managed
        ? await loadStoredConfig(deps.pool, deps.encryptionKey, id)
        : ((await resolveLegacyConfig(deps.pool, deps.encryptionKey, marketplace, env))?.config ?? null)
    )
    if (!stored) return send(res, 409, { error: "not_configured" })
    const result =
      marketplace === "shopify"
        ? await testShopify(stored as ShopifyConfig)
        : await testWoo(stored as WooCommerceConfig)
    if (!result.ok) {
      await setStatusById(deps.pool, id, "error", result.message)
    } else if (deps.manager.get(id)) {
      // Only mark connected when a runtime is actually live; otherwise the badge
      // would claim a sync that is not running.
      await setStatusById(deps.pool, id, "connected", null)
    }
    send(res, 200, result)
  }

  const link = async (id: string, res: http.ServerResponse) => {
    const row = await findRow(id)
    if (!row) return send(res, 404, { error: "not_found" })
    const live = deps.manager.get(id)
    if (!live) return send(res, 409, { error: "not_running" })
    const r = await live.runtime.relink()
    send(res, 200, {
      linked: r.linked,
      already_linked: r.alreadyLinked,
      unmatched: r.unmatched.length,
      duplicates: r.duplicates.length,
    })
  }

  const remove = async (id: string, res: http.ServerResponse) => {
    const row = await findRow(id)
    if (!row) return send(res, 404, { error: "not_found" })
    if (!row.managed) return send(res, 400, { error: "read_only" })
    await deps.manager.stop(id)
    await clearConnectionById(deps.pool, id)
    send(res, 200, { ok: true })
  }

  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parts: string[]
  ): Promise<void> => {
    const method = req.method ?? "GET"
    // parts: ["internal", "connections", id?, action?]
    if (parts[0] !== "internal" || parts[1] !== "connections" || parts.length > 4) {
      return send(res, 404, { error: "not_found" })
    }
    if (parts.length === 2) {
      if (method === "GET") return list(res)
      if (method === "POST") return create(req, res)
      return send(res, 405, { error: "method_not_allowed" })
    }
    const id = parts[2]!
    const action = parts[3]
    if (!UUID.test(id)) return send(res, 404, { error: "not_found" })
    if (action !== undefined && action !== "test" && action !== "link") {
      return send(res, 404, { error: "not_found" })
    }
    const expected = action === undefined ? ["PUT", "DELETE"] : ["POST"]
    if (!expected.includes(method)) return send(res, 405, { error: "method_not_allowed" })
    if (action === "test") return testStored(id, res)
    if (action === "link") return link(id, res)
    if (method === "PUT") return edit(id, req, res)
    return remove(id, res)
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
