import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  shopify: null as any,
  woo: null as any,
  decryptFail: false,
  statuses: [] as { marketplace: string; status: string; lastError: string | null }[],
  rows: [] as any[],
}))

vi.mock("./credentials.js", () => ({
  resolveShopifyConfig: vi.fn(async () => {
    if (state.decryptFail) throw new Error("bad decrypt SECRET_IN_DECRYPT")
    return state.shopify
  }),
  resolveWooConfig: vi.fn(async () => state.woo),
  setConnectionStatus: vi.fn(
    async (_p: unknown, marketplace: string, status: string, lastError: string | null) => {
      state.statuses.push({ marketplace, status, lastError })
    }
  ),
  listConnectionRows: vi.fn(async () => state.rows),
}))

import { createConnectorManager } from "./manager.js"

const SECRET = "shpat_TOP_SECRET_VALUE"
const cfg = (token: string) => ({
  shopDomain: "d.myshopify.com",
  accessToken: token,
  webhookSecret: "w",
  locationId: "1",
})
const wcfg = { siteUrl: "https://x.com", consumerKey: "ck", consumerSecret: "cs", webhookSecret: "w" }

const makeRuntime = (log: string[], name: string) => {
  const rt: any = {
    webhook: {},
    linked: Promise.resolve(null),
    relink: vi.fn(),
    stop: vi.fn(async () => {
      log.push(`stop:${name}`)
    }),
  }
  return rt
}

const baseDeps = {
  pool: {} as any,
  medusaClient: {} as any,
  encryptionKey: "k",
  redisConnection: {} as any,
  reconcileIntervalMs: 1,
  env: {},
}

const setup = () => {
  const log: string[] = []
  const startShopify = vi.fn(async (deps: any) => {
    const name = `s:${deps.config.accessToken}`
    log.push(`start:${name}`)
    await new Promise((r) => setTimeout(r, 5))
    log.push(`started:${name}`)
    return makeRuntime(log, name)
  })
  const startWooCommerce = vi.fn(async () => makeRuntime(log, "w"))
  const mgr = createConnectorManager({
    ...baseDeps,
    startShopify: startShopify as any,
    startWooCommerce: startWooCommerce as any,
  })
  return { log, startShopify, startWooCommerce, mgr }
}

beforeEach(() => {
  state.shopify = null
  state.woo = null
  state.decryptFail = false
  state.statuses = []
  state.rows = [{ marketplace: "shopify", salesChannelId: "sc_1" }]
})

describe("connector manager", () => {
  it("starts an env-only config and marks connected", async () => {
    const { mgr, startShopify } = setup()
    state.shopify = { config: cfg("env"), source: "environment" }
    expect(await mgr.apply("shopify")).toEqual({ started: true })
    expect(startShopify).toHaveBeenCalledTimes(1)
    expect(startShopify.mock.calls[0][0].salesChannelId).toBe("sc_1")
    expect(mgr.getShopify()).not.toBeNull()
    expect(state.statuses.at(-1)).toEqual({ marketplace: "shopify", status: "connected", lastError: null })
  })

  it("uses the resolved (database) config", async () => {
    const { mgr, startShopify } = setup()
    state.shopify = { config: cfg("db"), source: "database" }
    await mgr.apply("shopify")
    expect(startShopify.mock.calls[0][0].config.accessToken).toBe("db")
  })

  it("serializes concurrent applies: stop before next start, strictly sequential, re-reads config", async () => {
    const { mgr, log } = setup()
    state.shopify = { config: cfg("a"), source: "database" }
    const p1 = mgr.apply("shopify")
    const p2 = mgr.apply("shopify")
    // Changed after both were issued: the first apply has already read "a"
    // (resolve runs on a later tick), the second must pick up the newest.
    await Promise.all([p1, p2])
    expect(log).toEqual(["start:s:a", "started:s:a", "stop:s:a", "start:s:a", "started:s:a"])
    expect(mgr.getShopify()).not.toBeNull()
  })

  it("awaits the old runtime's linked promise before starting the replacement", async () => {
    const { mgr, startShopify } = setup()
    state.shopify = { config: cfg("a"), source: "database" }
    await mgr.apply("shopify")
    const old = mgr.getShopify() as any
    let release!: () => void
    old.linked = new Promise<null>((r) => (release = () => r(null)))
    const p = mgr.apply("shopify")
    await new Promise((r) => setTimeout(r, 20))
    expect(old.stop).toHaveBeenCalled()
    expect(startShopify).toHaveBeenCalledTimes(1)
    release()
    await p
    expect(startShopify).toHaveBeenCalledTimes(2)
  })

  it("a throwing start leaves no runtime, sets error, never leaks the message", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")]
    state.shopify = { config: cfg("x"), source: "database" }
    state.woo = { config: wcfg, source: "database" }
    const mgr = createConnectorManager({
      ...baseDeps,
      startShopify: (async () => {
        throw new TypeError(`boom ${SECRET}`)
      }) as any,
      startWooCommerce: (async () => makeRuntime([], "w")) as any,
    })
    const r = await mgr.apply("shopify")
    expect(r.started).toBe(false)
    expect(mgr.getShopify()).toBeNull()
    expect(state.statuses.at(-1)!.status).toBe("error")
    expect(state.statuses.at(-1)!.lastError).toBeTruthy()
    expect(JSON.stringify([r, state.statuses])).not.toContain(SECRET)
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET)
    expect((await mgr.apply("woocommerce")).started).toBe(true)
    spies.forEach((s) => s.mockRestore())
  })

  it("an undecryptable stored credential sets error and starts nothing", async () => {
    const { mgr, startShopify } = setup()
    state.decryptFail = true
    const spy = vi.spyOn(console, "error")
    const r = await mgr.apply("shopify")
    expect(r.started).toBe(false)
    expect(startShopify).not.toHaveBeenCalled()
    expect(state.statuses.at(-1)?.status).toBe("error")
    expect(JSON.stringify([r, state.statuses, spy.mock.calls])).not.toContain("SECRET_IN_DECRYPT")
    spy.mockRestore()
  })

  it("no config sets disconnected and stops a running runtime", async () => {
    const { mgr } = setup()
    state.shopify = { config: cfg("a"), source: "database" }
    await mgr.apply("shopify")
    const rt = mgr.getShopify() as any
    state.shopify = null
    expect(await mgr.apply("shopify")).toEqual({ started: false })
    expect(rt.stop).toHaveBeenCalled()
    expect(mgr.getShopify()).toBeNull()
    expect(state.statuses.at(-1)?.status).toBe("disconnected")
  })

  it("stop stops the runtime and getX returns null", async () => {
    const { mgr } = setup()
    state.woo = { config: wcfg, source: "database" }
    await mgr.apply("woocommerce")
    const rt = mgr.getWooCommerce() as any
    await mgr.stop("woocommerce")
    expect(rt.stop).toHaveBeenCalled()
    expect(mgr.getWooCommerce()).toBeNull()
  })

  it("applyAll applies both independently; stopAll never throws", async () => {
    const mgr = createConnectorManager({
      ...baseDeps,
      startShopify: (async () => {
        throw new Error("nope")
      }) as any,
      startWooCommerce: (async () => makeRuntime([], "w")) as any,
    })
    state.shopify = { config: cfg("a"), source: "database" }
    state.woo = { config: wcfg, source: "database" }
    await mgr.applyAll()
    expect(mgr.getShopify()).toBeNull()
    expect(mgr.getWooCommerce()).not.toBeNull()
    const rt = mgr.getWooCommerce() as any
    rt.stop.mockRejectedValueOnce(new Error("x"))
    await expect(mgr.stopAll()).resolves.toBeUndefined()
    expect(mgr.getWooCommerce()).toBeNull()
  })
})
