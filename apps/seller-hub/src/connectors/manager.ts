import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { startShopify, type ShopifyRuntime } from "../shopify/bootstrap.js"
import { startWooCommerce, type WooCommerceRuntime } from "../woocommerce/bootstrap.js"
import {
  listConnectionRows,
  resolveShopifyConfig,
  resolveWooConfig,
  setConnectionStatus,
  type LegacyMarketplace as Marketplace,
} from "./credentials.js"

export type ConnectorManagerDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  encryptionKey: string
  redisConnection: IORedis
  reconcileIntervalMs: number
  env?: NodeJS.ProcessEnv
  startShopify?: typeof startShopify
  startWooCommerce?: typeof startWooCommerce
}

export type ConnectorManager = {
  getShopify(): ShopifyRuntime | null
  getWooCommerce(): WooCommerceRuntime | null
  apply(marketplace: Marketplace): Promise<{ started: boolean; error?: string }>
  stop(marketplace: Marketplace): Promise<void>
  applyAll(): Promise<void>
  stopAll(): Promise<void>
}

type AnyRuntime = ShopifyRuntime | WooCommerceRuntime

const MARKETPLACES: Marketplace[] = ["shopify", "woocommerce"]
const START_FAILED = "failed to start"
const UNREADABLE = "stored credentials could not be read"

/** Never log err.message: upstream messages can embed config values. */
const errName = (err: unknown): string => (err instanceof Error ? err.constructor.name : typeof err)

export const createConnectorManager = (deps: ConnectorManagerDeps): ConnectorManager => {
  const start = {
    shopify: deps.startShopify ?? startShopify,
    woocommerce: deps.startWooCommerce ?? startWooCommerce,
  }
  const runtimes: Record<Marketplace, AnyRuntime | null> = { shopify: null, woocommerce: null }
  const locks: Record<Marketplace, Promise<unknown>> = {
    shopify: Promise.resolve(),
    woocommerce: Promise.resolve(),
  }

  const safeStatus = async (
    marketplace: Marketplace,
    status: "connected" | "disconnected" | "error",
    lastError: string | null
  ): Promise<void> => {
    try {
      await setConnectionStatus(deps.pool, marketplace, status, lastError)
    } catch (err) {
      console.error(`[seller-hub] ${marketplace} status update failed (${errName(err)})`)
    }
  }

  /** Stops the running runtime (never throws), then waits out its in-flight SKU link. */
  const stopRuntime = async (marketplace: Marketplace): Promise<void> => {
    const rt = runtimes[marketplace]
    runtimes[marketplace] = null
    if (!rt) return
    try {
      await rt.stop()
    } catch (err) {
      console.error(`[seller-hub] ${marketplace} stop failed (${errName(err)})`)
    }
    // `linked` never rejects; stop() does not wait for it, so wait here to
    // keep two SKU links from running concurrently.
    try {
      await rt.linked
    } catch {
      // ignore
    }
  }

  const serialize = <T>(marketplace: Marketplace, fn: () => Promise<T>): Promise<T> => {
    const run = locks[marketplace].then(fn, fn)
    locks[marketplace] = run.catch(() => undefined)
    return run
  }

  const doApply = async (marketplace: Marketplace): Promise<{ started: boolean; error?: string }> => {
    await stopRuntime(marketplace)

    let resolved: { config: unknown } | null
    try {
      resolved =
        marketplace === "shopify"
          ? await resolveShopifyConfig(deps.pool, deps.encryptionKey, deps.env)
          : await resolveWooConfig(deps.pool, deps.encryptionKey, deps.env)
    } catch (err) {
      console.error(`[seller-hub] ${marketplace}: ${UNREADABLE} (${errName(err)})`)
      await safeStatus(marketplace, "error", UNREADABLE)
      return { started: false, error: UNREADABLE }
    }

    if (!resolved) {
      await safeStatus(marketplace, "disconnected", null)
      return { started: false }
    }

    try {
      const rows = await listConnectionRows(deps.pool)
      const salesChannelId = rows.find((r) => r.marketplace === marketplace)?.salesChannelId ?? null
      const common = {
        pool: deps.pool,
        medusaClient: deps.medusaClient,
        encryptionKey: deps.encryptionKey,
        redisConnection: deps.redisConnection,
        reconcileIntervalMs: deps.reconcileIntervalMs,
        salesChannelId,
      }
      runtimes[marketplace] =
        marketplace === "shopify"
          ? await start.shopify({ ...common, config: resolved.config as never })
          : await start.woocommerce({ ...common, config: resolved.config as never })
    } catch (err) {
      runtimes[marketplace] = null
      console.error(`[seller-hub] ${marketplace} failed to start (${errName(err)})`)
      await safeStatus(marketplace, "error", START_FAILED)
      return { started: false, error: START_FAILED }
    }

    await safeStatus(marketplace, "connected", null)
    return { started: true }
  }

  const apply: ConnectorManager["apply"] = (marketplace) =>
    serialize(marketplace, async () => {
      try {
        return await doApply(marketplace)
      } catch (err) {
        console.error(`[seller-hub] ${marketplace} apply failed (${errName(err)})`)
        return { started: false, error: START_FAILED }
      }
    })

  const stop: ConnectorManager["stop"] = (marketplace) =>
    serialize(marketplace, () => stopRuntime(marketplace))

  return {
    getShopify: () => runtimes.shopify as ShopifyRuntime | null,
    getWooCommerce: () => runtimes.woocommerce as WooCommerceRuntime | null,
    apply,
    stop,
    applyAll: async () => {
      await Promise.all(MARKETPLACES.map((m) => apply(m)))
    },
    stopAll: async () => {
      await Promise.all(MARKETPLACES.map((m) => stop(m).catch(() => undefined)))
    },
  }
}
