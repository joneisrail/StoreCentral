import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { createSyncQueue } from "../queue/queues.js"
import { RECONCILE_SHOPIFY_JOB, startShopify, type ShopifyRuntime } from "../shopify/bootstrap.js"
import {
  RECONCILE_WOOCOMMERCE_JOB,
  startWooCommerce,
  type WooCommerceRuntime,
} from "../woocommerce/bootstrap.js"
import {
  listConnectionRows,
  loadStoredConfig,
  resolveLegacyConfig,
  setStatusById,
  type ConnectionRow,
  type LegacyMarketplace,
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
  /** Used only to clear stale legacy repeatable jobs; tests inject a fake. */
  createQueue?: typeof createSyncQueue
}

export type LiveConnector =
  | { id: string; marketplace: "shopify"; legacy: boolean; runtime: ShopifyRuntime }
  | { id: string; marketplace: "woocommerce"; legacy: boolean; runtime: WooCommerceRuntime }

export type ConnectorManager = {
  get(id: string): LiveConnector | null
  /** Creation order; the legacy env connector last. */
  list(marketplace?: LegacyMarketplace): LiveConnector[]
  apply(id: string): Promise<{ started: boolean; error?: string }>
  stop(id: string): Promise<void>
  /** Every managed row with credentials, plus the legacy env connector per marketplace with no managed row. */
  applyAll(): Promise<void>
  stopAll(): Promise<void>
}

type Result = { started: boolean; error?: string }

const MARKETPLACES: LegacyMarketplace[] = ["shopify", "woocommerce"]
const START_FAILED = "failed to start"
const UNREADABLE = "stored credentials could not be read"

const RECONCILE_JOB: Record<LegacyMarketplace, string> = {
  shopify: RECONCILE_SHOPIFY_JOB,
  woocommerce: RECONCILE_WOOCOMMERCE_JOB,
}

/** Never log err.message: upstream messages can embed config values. */
const errName = (err: unknown): string => (err instanceof Error ? err.constructor.name : typeof err)

const isLegacyMarketplace = (m: string): m is LegacyMarketplace => m === "shopify" || m === "woocommerce"

export const createConnectorManager = (deps: ConnectorManagerDeps): ConnectorManager => {
  const start = {
    shopify: deps.startShopify ?? startShopify,
    woocommerce: deps.startWooCommerce ?? startWooCommerce,
  }
  const createQueue = deps.createQueue ?? createSyncQueue

  /** Insertion order is creation order; `legacyIds` are listed last. */
  const live = new Map<string, LiveConnector>()
  const legacyIds = new Set<string>()
  const locks = new Map<string, Promise<unknown>>()

  const serialize = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(key) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    const tail = run.catch(() => undefined)
    locks.set(key, tail)
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key)
    })
    return run
  }

  const safeStatus = async (
    id: string,
    marketplace: string,
    status: "connected" | "disconnected" | "error",
    lastError: string | null
  ): Promise<void> => {
    try {
      await setStatusById(deps.pool, id, status, lastError)
    } catch (err) {
      console.error(`[seller-hub] ${marketplace} status update failed (${errName(err)})`)
    }
  }

  /** Stops the running runtime (never throws), then waits out its in-flight SKU link. */
  const stopRuntime = async (id: string): Promise<void> => {
    const entry = live.get(id)
    live.delete(id)
    legacyIds.delete(id)
    if (!entry) return
    try {
      await entry.runtime.stop()
    } catch (err) {
      console.error(`[seller-hub] ${entry.marketplace} stop failed (${errName(err)})`)
    }
    // `linked` never rejects; stop() does not wait for it, so wait here to
    // keep two SKU links from running concurrently.
    try {
      await entry.runtime.linked
    } catch {
      // ignore
    }
  }

  const register = (id: string, marketplace: LegacyMarketplace, runtime: unknown, legacy: boolean) => {
    live.set(id, { id, marketplace, legacy, runtime } as LiveConnector)
    if (legacy) legacyIds.add(id)
  }

  /** `accountId` set = managed row; unset = legacy runtime (resolves its own unmanaged row). */
  const launch = async (
    target: {
      marketplace: LegacyMarketplace
      salesChannelId: string | null
      accountId?: string
      displayId?: string
    },
    config: unknown
  ): Promise<unknown> => {
    const common = {
      pool: deps.pool,
      medusaClient: deps.medusaClient,
      encryptionKey: deps.encryptionKey,
      redisConnection: deps.redisConnection,
      reconcileIntervalMs: deps.reconcileIntervalMs,
      salesChannelId: target.salesChannelId,
      ...(target.accountId ? { accountId: target.accountId, displayId: target.displayId } : {}),
      config: config as never,
    }
    return target.marketplace === "shopify" ? start.shopify(common) : start.woocommerce(common)
  }

  const fail = async (id: string, marketplace: string, what: string, message: string): Promise<Result> => {
    console.error(`[seller-hub] ${marketplace} ${what}`)
    await safeStatus(id, marketplace, "error", message)
    return { started: false, error: message }
  }

  const doApply = async (id: string): Promise<Result> => {
    await stopRuntime(id)

    const rows = await listConnectionRows(deps.pool)
    const row = rows.find((r) => r.id === id)
    if (!row || !isLegacyMarketplace(row.marketplace)) return { started: false }
    const marketplace = row.marketplace

    let config: unknown
    try {
      if (row.managed) {
        config = await loadStoredConfig(deps.pool, deps.encryptionKey, id)
      } else {
        // A managed row supersedes the env connector (resolveLegacyConfig yields null then).
        config = (await resolveLegacyConfig(deps.pool, deps.encryptionKey, marketplace, deps.env))?.config ?? null
      }
    } catch (err) {
      return fail(id, marketplace, `${UNREADABLE} (${errName(err)})`, UNREADABLE)
    }
    if (!config) {
      await safeStatus(id, marketplace, "disconnected", null)
      return { started: false }
    }

    try {
      const runtime = await launch(
        {
          marketplace,
          salesChannelId: row.salesChannelId,
          ...(row.managed ? { accountId: id, displayId: row.displayName ?? id } : {}),
        },
        config
      )
      register(id, marketplace, runtime, !row.managed)
    } catch (err) {
      return fail(id, marketplace, `failed to start (${errName(err)})`, START_FAILED)
    }
    await safeStatus(id, marketplace, "connected", null)
    return { started: true }
  }

  const apply: ConnectorManager["apply"] = (id) =>
    serialize(id, async () => {
      try {
        return await doApply(id)
      } catch (err) {
        console.error(`[seller-hub] apply failed (${errName(err)})`)
        return { started: false, error: START_FAILED }
      }
    })

  const stop: ConnectorManager["stop"] = (id) => serialize(id, () => stopRuntime(id))

  /** Starts the env connector when no row exists yet: the start creates the row, whose id we then register. */
  const bootLegacy = (marketplace: LegacyMarketplace): Promise<void> =>
    serialize(`legacy:${marketplace}`, async () => {
      try {
        const resolved = await resolveLegacyConfig(deps.pool, deps.encryptionKey, marketplace, deps.env)
        if (!resolved) return
        const runtime = (await launch({ marketplace, salesChannelId: null }, resolved.config)) as {
          stop: () => Promise<void>
        }
        const rows = await listConnectionRows(deps.pool)
        const legacy = rows.find((r) => r.marketplace === marketplace && !r.managed)
        if (!legacy) {
          await runtime.stop().catch(() => undefined)
          console.error(`[seller-hub] ${marketplace} legacy connection row not found`)
          return
        }
        register(legacy.id, marketplace, runtime, true)
        await safeStatus(legacy.id, marketplace, "connected", null)
      } catch (err) {
        console.error(`[seller-hub] ${marketplace} failed to start (${errName(err)})`)
      }
    })

  /** Best effort: drops the old hourly reconcile job a migrated legacy queue would otherwise keep. */
  const removeStaleLegacyRepeatable = async (marketplace: LegacyMarketplace): Promise<void> => {
    try {
      const queue = createQueue(`${marketplace}-inventory-sync`, deps.redisConnection)
      try {
        await queue.removeRepeatable(RECONCILE_JOB[marketplace], { every: deps.reconcileIntervalMs })
      } finally {
        await queue.close()
      }
    } catch (err) {
      console.error(`[seller-hub] ${marketplace} stale reconcile cleanup failed (${errName(err)})`)
    }
  }

  const applyAll: ConnectorManager["applyAll"] = async () => {
    let rows: ConnectionRow[]
    try {
      rows = await listConnectionRows(deps.pool)
    } catch (err) {
      console.error(`[seller-hub] could not list connections (${errName(err)})`)
      return
    }
    const jobs: Promise<unknown>[] = []
    for (const marketplace of MARKETPLACES) {
      const ofMarketplace = rows.filter((r) => r.marketplace === marketplace)
      const managed = ofMarketplace.filter((r) => r.managed)
      for (const r of managed) if (r.hasStoredCredentials) jobs.push(apply(r.id))
      if (managed.length > 0) {
        for (const r of ofMarketplace) if (!r.managed) jobs.push(stop(r.id))
        continue
      }
      const legacyRow = ofMarketplace.find((r) => !r.managed)
      jobs.push(legacyRow ? apply(legacyRow.id) : bootLegacy(marketplace))
    }
    await Promise.all(jobs)

    const legacyLive = (m: LegacyMarketplace) =>
      [...live.values()].some((c) => c.marketplace === m && legacyIds.has(c.id))
    await Promise.all(MARKETPLACES.filter((m) => !legacyLive(m)).map(removeStaleLegacyRepeatable))
  }

  return {
    get: (id) => live.get(id) ?? null,
    list: (marketplace) => {
      const all = [...live.values()].filter((c) => !marketplace || c.marketplace === marketplace)
      return [...all.filter((c) => !legacyIds.has(c.id)), ...all.filter((c) => legacyIds.has(c.id))]
    },
    apply,
    stop,
    applyAll,
    stopAll: async () => {
      await Promise.all([...live.keys()].map((id) => stop(id).catch(() => undefined)))
    },
  }
}

/**
 * TEMPORARY (Tasks 4/5 delete this): the pre-multi-account manager shape that
 * `internal/connections.ts` and `index.ts` still consume. One connection per
 * marketplace: `apply`/`stop` address the marketplace's first row.
 */
export type LegacyConnectorManager = {
  getShopify(): ShopifyRuntime | null
  getWooCommerce(): WooCommerceRuntime | null
  apply(marketplace: LegacyMarketplace): Promise<Result>
  stop(marketplace: LegacyMarketplace): Promise<void>
  applyAll(): Promise<void>
  stopAll(): Promise<void>
}

export const legacyManagerView = (manager: ConnectorManager, pool: Pool): LegacyConnectorManager => {
  const rowId = async (marketplace: LegacyMarketplace): Promise<string | null> => {
    const rows = await listConnectionRows(pool)
    return (
      rows.find((r) => r.marketplace === marketplace && !r.managed)?.id ??
      rows.find((r) => r.marketplace === marketplace)?.id ??
      null
    )
  }
  return {
    getShopify: () => (manager.list("shopify")[0]?.runtime as ShopifyRuntime | undefined) ?? null,
    getWooCommerce: () => (manager.list("woocommerce")[0]?.runtime as WooCommerceRuntime | undefined) ?? null,
    apply: async (marketplace) => {
      const id = await rowId(marketplace)
      return id ? manager.apply(id) : { started: false }
    },
    stop: async (marketplace) => {
      const id = await rowId(marketplace)
      if (id) await manager.stop(id)
    },
    applyAll: () => manager.applyAll(),
    stopAll: () => manager.stopAll(),
  }
}
