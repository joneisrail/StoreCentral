import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = {
  id: string
  marketplace: string
  managed: boolean
  displayName: string | null
  salesChannelId: string | null
  hasStoredCredentials: boolean
  status: string
}

const state = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  legacy: {} as Record<string, unknown>,
  decryptFail: false,
  statuses: [] as { id: string; status: string; lastError: string | null }[],
  rows: [] as any[],
}))

vi.mock("./credentials.js", async (importOriginal) => ({
  // Real shared predicate: the manager and resolveLegacyConfig must agree on it.
  managedSupersedesLegacy: (await importOriginal<typeof import("./credentials.js")>()).managedSupersedesLegacy,
  loadStoredConfig: vi.fn(async (_p: unknown, _k: string, id: string) => {
    if (state.decryptFail) throw new Error("bad decrypt SECRET_IN_DECRYPT")
    return state.stored[id] ?? null
  }),
  resolveLegacyConfig: vi.fn(async (_p: unknown, _k: string, marketplace: string) => {
    const config = state.legacy[marketplace]
    return config ? { config, source: "environment" } : null
  }),
  setStatusById: vi.fn(async (_p: unknown, id: string, status: string, lastError: string | null) => {
    state.statuses.push({ id, status, lastError })
  }),
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

const row = (id: string, marketplace: string, over: Partial<Row> = {}): Row => ({
  id,
  marketplace,
  managed: true,
  displayName: `name-${id}`,
  salesChannelId: `sc_${id}`,
  hasStoredCredentials: true,
  status: "connected",
  ...over,
})

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

const fakeQueues = () => {
  const made: any[] = []
  const createQueue = vi.fn((name: string) => {
    const q = { name, removeRepeatable: vi.fn(async () => true), close: vi.fn(async () => {}) }
    made.push(q)
    return q
  })
  return { made, createQueue }
}

const baseDeps = {
  pool: {} as any,
  medusaClient: {} as any,
  encryptionKey: "k",
  redisConnection: {} as any,
  reconcileIntervalMs: 1234,
  env: {},
}

const setup = () => {
  const log: string[] = []
  const startShopify = vi.fn(async (deps: any) => {
    const name = `s:${deps.accountId ?? "legacy"}:${deps.config.accessToken}`
    log.push(`start:${name}`)
    await new Promise((r) => setTimeout(r, 5))
    log.push(`started:${name}`)
    return makeRuntime(log, name)
  })
  const startWooCommerce = vi.fn(async (deps: any) => makeRuntime(log, `w:${deps.accountId ?? "legacy"}`))
  const queues = fakeQueues()
  const mgr = createConnectorManager({
    ...baseDeps,
    startShopify: startShopify as any,
    startWooCommerce: startWooCommerce as any,
    createQueue: queues.createQueue as any,
  })
  return { log, startShopify, startWooCommerce, mgr, queues }
}

beforeEach(() => {
  state.stored = {}
  state.legacy = {}
  state.decryptFail = false
  state.statuses = []
  state.rows = []
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("connector manager", () => {
  it("starts a managed row with its account id, sales channel and display name", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("a", "shopify")]
    state.stored.a = cfg("ta")
    expect(await mgr.apply("a")).toEqual({ started: true })
    const call = startShopify.mock.calls[0]![0]
    expect(call).toMatchObject({ accountId: "a", displayId: "name-a", salesChannelId: "sc_a" })
    expect(call.config.accessToken).toBe("ta")
    expect(mgr.get("a")).toMatchObject({ id: "a", marketplace: "shopify" })
    expect(state.statuses.at(-1)).toEqual({ id: "a", status: "connected", lastError: null })
  })

  it("two shopify connections start independently with distinct runtimes", async () => {
    const { mgr } = setup()
    state.rows = [row("a", "shopify"), row("b", "shopify")]
    state.stored.a = cfg("ta")
    state.stored.b = cfg("tb")
    await Promise.all([mgr.apply("a"), mgr.apply("b")])
    const a = mgr.get("a")!
    const b = mgr.get("b")!
    expect(a.runtime).not.toBe(b.runtime)
    expect(mgr.list("shopify").map((c) => c.id)).toEqual(["a", "b"])
  })

  it("stopping one leaves the other running", async () => {
    const { mgr } = setup()
    state.rows = [row("a", "shopify"), row("b", "shopify")]
    state.stored.a = cfg("ta")
    state.stored.b = cfg("tb")
    await mgr.apply("a")
    await mgr.apply("b")
    const rtA = mgr.get("a")!.runtime as any
    const rtB = mgr.get("b")!.runtime as any
    await mgr.stop("a")
    expect(rtA.stop).toHaveBeenCalledTimes(1)
    expect(rtB.stop).not.toHaveBeenCalled()
    expect(mgr.get("a")).toBeNull()
    expect(mgr.get("b")).not.toBeNull()
  })

  it("one failing start leaves the other running and sets only its own status error", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")]
    const queues = fakeQueues()
    const mgr = createConnectorManager({
      ...baseDeps,
      createQueue: queues.createQueue as any,
      startShopify: (async (d: any) => {
        if (d.accountId === "bad") throw new TypeError(`boom ${SECRET}`)
        return makeRuntime([], "ok")
      }) as any,
      startWooCommerce: (async () => makeRuntime([], "w")) as any,
    })
    state.rows = [row("bad", "shopify"), row("good", "shopify")]
    state.stored.bad = cfg("x")
    state.stored.good = cfg("y")
    await mgr.applyAll()
    expect(mgr.get("bad")).toBeNull()
    expect(mgr.get("good")).not.toBeNull()
    expect(state.statuses.filter((s) => s.id === "bad").at(-1)!.status).toBe("error")
    expect(state.statuses.filter((s) => s.id === "good").at(-1)!.status).toBe("connected")
    expect(state.statuses.some((s) => s.id === "good" && s.status === "error")).toBe(false)
    const out = JSON.stringify([state.statuses, spies.map((s) => s.mock.calls)])
    expect(out).not.toContain(SECRET)
    expect(out).toContain("TypeError")
    spies.forEach((s) => s.mockRestore())
  })

  it("concurrent applies for one id run one at a time, different ids run in parallel", async () => {
    const { mgr, log } = setup()
    state.rows = [row("a", "shopify"), row("b", "shopify")]
    state.stored.a = cfg("ta")
    state.stored.b = cfg("tb")
    await Promise.all([mgr.apply("a"), mgr.apply("a")])
    expect(log).toEqual(["start:s:a:ta", "started:s:a:ta", "stop:s:a:ta", "start:s:a:ta", "started:s:a:ta"])

    log.length = 0
    await Promise.all([mgr.stop("a"), mgr.stop("b")])
    log.length = 0
    await Promise.all([mgr.apply("a"), mgr.apply("b")])
    expect(log.slice(0, 2).sort()).toEqual(["start:s:a:ta", "start:s:b:tb"])
  })

  it("awaits the old runtime's linked promise before starting the replacement", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("a", "shopify")]
    state.stored.a = cfg("ta")
    await mgr.apply("a")
    const old = mgr.get("a")!.runtime as any
    let release!: () => void
    old.linked = new Promise<null>((r) => (release = () => r(null)))
    const p = mgr.apply("a")
    await new Promise((r) => setTimeout(r, 20))
    expect(old.stop).toHaveBeenCalled()
    expect(startShopify).toHaveBeenCalledTimes(1)
    release()
    await p
    expect(startShopify).toHaveBeenCalledTimes(2)
  })

  it("an undecryptable stored credential sets error and starts nothing", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("a", "shopify")]
    state.decryptFail = true
    const spy = vi.spyOn(console, "error")
    const r = await mgr.apply("a")
    expect(r.started).toBe(false)
    expect(startShopify).not.toHaveBeenCalled()
    expect(state.statuses.at(-1)?.status).toBe("error")
    expect(JSON.stringify([r, state.statuses, spy.mock.calls])).not.toContain("SECRET_IN_DECRYPT")
  })

  it("a managed row without stored credentials is not started and is marked disconnected", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("a", "shopify", { hasStoredCredentials: false })]
    await mgr.applyAll()
    expect(startShopify).not.toHaveBeenCalled()
    expect(await mgr.apply("a")).toEqual({ started: false })
    expect(state.statuses.at(-1)).toEqual({ id: "a", status: "disconnected", lastError: null })
  })

  it("apply with no stored config stops a running runtime", async () => {
    const { mgr } = setup()
    state.rows = [row("a", "shopify")]
    state.stored.a = cfg("ta")
    await mgr.apply("a")
    const rt = mgr.get("a")!.runtime as any
    delete state.stored.a
    expect(await mgr.apply("a")).toEqual({ started: false })
    expect(rt.stop).toHaveBeenCalled()
    expect(mgr.get("a")).toBeNull()
    expect(state.statuses.at(-1)?.status).toBe("disconnected")
  })

  it("legacy env connector is skipped when a managed row exists for that marketplace", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("m", "shopify"), row("l", "shopify", { managed: false, displayName: null })]
    state.stored.m = cfg("tm")
    state.legacy.shopify = cfg("env")
    await mgr.applyAll()
    expect(startShopify).toHaveBeenCalledTimes(1)
    expect(startShopify.mock.calls[0]![0].accountId).toBe("m")
    expect(mgr.get("l")).toBeNull()
  })

  it("applyAll starts only managed rows that are connected; error and disconnected rows stay off untouched", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [
      row("ok", "shopify"),
      row("err", "shopify", { status: "error" }),
      row("off", "shopify", { status: "disconnected" }),
    ]
    state.stored.ok = cfg("a")
    state.stored.err = cfg("b")
    state.stored.off = cfg("c")
    await mgr.applyAll()
    expect(startShopify).toHaveBeenCalledTimes(1)
    expect(mgr.get("ok")).not.toBeNull()
    expect(mgr.get("err")).toBeNull()
    expect(mgr.get("off")).toBeNull()
    expect(state.statuses.filter((x) => x.id === "err" || x.id === "off")).toEqual([])
  })

  it("an error managed row does not supersede the legacy env connector (existing legacy row)", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("m", "shopify", { status: "error" }), row("l", "shopify", { managed: false, displayName: null })]
    state.stored.m = cfg("tm")
    state.legacy.shopify = cfg("env")
    await mgr.applyAll()
    expect(startShopify).toHaveBeenCalledTimes(1)
    expect(startShopify.mock.calls[0]![0].accountId).toBeUndefined()
    expect(mgr.get("l")).not.toBeNull()
    expect(mgr.get("m")).toBeNull()
  })

  it("env-only plus one managed row in error: the legacy env connector still starts", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("m", "shopify", { status: "error" })]
    state.legacy.shopify = cfg("env")
    startShopify.mockImplementationOnce(async () => {
      state.rows = [...state.rows, row("created", "shopify", { managed: false, displayName: null })]
      return makeRuntime([], "s") as any
    })
    await mgr.applyAll()
    expect(startShopify).toHaveBeenCalledTimes(1)
    expect(mgr.get("created")).toMatchObject({ legacy: true })
  })

  it("a disconnected managed row does not supersede the legacy env connector", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [
      row("m", "shopify", { status: "disconnected" }),
      row("l", "shopify", { managed: false, displayName: null }),
    ]
    state.legacy.shopify = cfg("env")
    await mgr.applyAll()
    expect(startShopify).toHaveBeenCalledTimes(1)
    expect(startShopify.mock.calls[0]![0].config.accessToken).toBe("env")
  })

  it("applyAll stops a running legacy connector once a managed row exists", async () => {
    const { mgr } = setup()
    state.rows = [row("l", "shopify", { managed: false, displayName: null })]
    state.legacy.shopify = cfg("env")
    await mgr.applyAll()
    const legacy = mgr.get("l")!.runtime as any
    state.rows = [row("m", "shopify"), ...state.rows]
    state.stored.m = cfg("tm")
    await mgr.applyAll()
    expect(legacy.stop).toHaveBeenCalled()
    expect(mgr.get("l")).toBeNull()
    expect(mgr.get("m")).not.toBeNull()
  })

  it("legacy env connector starts when no managed row exists (existing legacy row)", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("l", "shopify", { managed: false, displayName: null, salesChannelId: null })]
    state.legacy.shopify = cfg("env")
    await mgr.applyAll()
    const call = startShopify.mock.calls[0]![0]
    expect(call.accountId).toBeUndefined()
    expect(call.config.accessToken).toBe("env")
    expect(mgr.get("l")).toMatchObject({ id: "l", marketplace: "shopify" })
  })

  it("legacy env connector starts when no row exists yet and is addressed by the created row id", async () => {
    const { mgr, startWooCommerce } = setup()
    state.legacy.woocommerce = wcfg
    startWooCommerce.mockImplementationOnce(async () => {
      // The real start creates the unmanaged row via resolveWooCommerceAccount.
      state.rows = [row("created", "woocommerce", { managed: false, displayName: null })]
      return makeRuntime([], "w") as any
    })
    await mgr.applyAll()
    expect(mgr.get("created")).toMatchObject({ id: "created", marketplace: "woocommerce" })
    expect(state.statuses.at(-1)).toEqual({ id: "created", status: "connected", lastError: null })
  })

  it("withLock holds the per-id lock: a concurrent apply waits, and ops inside do not deadlock", async () => {
    const { mgr, startShopify } = setup()
    state.rows = [row("m", "shopify")]
    state.stored.m = cfg("tm")
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const locked = mgr.withLock("m", async (ops) => {
      events.push("enter")
      await gate
      const r = await ops.apply() // would deadlock if it re-entered the lock
      events.push(`inner-apply:${r.started}`)
      await ops.stop()
      events.push("inner-stop")
    })
    const outside = mgr.apply("m").then(() => events.push("outside-apply"))
    await new Promise((r) => setTimeout(r, 20))
    // the outside apply has not started while the lock is held
    expect(startShopify).not.toHaveBeenCalled()
    expect(events).toEqual(["enter"])
    release()
    await Promise.all([locked, outside])
    expect(events).toEqual(["enter", "inner-apply:true", "inner-stop", "outside-apply"])
    expect(startShopify).toHaveBeenCalledTimes(2)
  })

  it("list puts the legacy connector last", async () => {
    const { mgr } = setup()
    state.rows = [row("l", "shopify", { managed: false }), row("m", "shopify")]
    state.legacy.shopify = cfg("env")
    state.stored.m = cfg("tm")
    await mgr.apply("l")
    await mgr.apply("m")
    // apply("l") with a managed row present yields no legacy config in the real
    // resolver; here the fake returns env, so it is live and must sort last.
    expect(mgr.list().map((c) => c.id)).toEqual(["m", "l"])
    expect(mgr.list().map((c) => c.legacy)).toEqual([false, true])
  })

  it("amazon rows are ignored", async () => {
    const { mgr, startShopify, startWooCommerce } = setup()
    state.rows = [row("z", "amazon")]
    await mgr.applyAll()
    expect(await mgr.apply("z")).toEqual({ started: false })
    expect(startShopify).not.toHaveBeenCalled()
    expect(startWooCommerce).not.toHaveBeenCalled()
    expect(state.statuses).toEqual([])
  })

  it("applyAll removes stale legacy repeatables for marketplaces without a legacy runtime", async () => {
    const { mgr, queues } = setup()
    state.rows = [row("m", "shopify")]
    state.stored.m = cfg("tm")
    await mgr.applyAll()
    const byName = Object.fromEntries(queues.made.map((q) => [q.name, q]))
    expect(Object.keys(byName).sort()).toEqual(["shopify-inventory-sync", "woocommerce-inventory-sync"])
    expect(byName["shopify-inventory-sync"].removeRepeatable).toHaveBeenCalledWith("reconcile-shopify", { every: 1234 })
    expect(byName["woocommerce-inventory-sync"].removeRepeatable).toHaveBeenCalledWith(
      expect.stringContaining("woocommerce"),
      { every: 1234 }
    )
    for (const q of queues.made) expect(q.close).toHaveBeenCalled()
  })

  it("applyAll leaves the legacy queue alone while a legacy runtime uses it", async () => {
    const { mgr, queues } = setup()
    state.rows = [row("l", "shopify", { managed: false })]
    state.legacy.shopify = cfg("env")
    await mgr.applyAll()
    expect(queues.made.map((q) => q.name)).toEqual(["woocommerce-inventory-sync"])
  })

  it("stale cleanup failures never throw and log only marketplace and constructor name", async () => {
    const err = vi.spyOn(console, "error")
    const mgr = createConnectorManager({
      ...baseDeps,
      startShopify: (async () => makeRuntime([], "s")) as any,
      startWooCommerce: (async () => makeRuntime([], "w")) as any,
      createQueue: (() => {
        throw new RangeError(`redis down ${SECRET}`)
      }) as any,
    })
    state.rows = []
    await expect(mgr.applyAll()).resolves.toBeUndefined()
    const out = JSON.stringify(err.mock.calls)
    expect(out).toContain("shopify")
    expect(out).toContain("RangeError")
    expect(out).not.toContain(SECRET)
  })

  it("stopAll never throws and empties the manager", async () => {
    const { mgr } = setup()
    state.rows = [row("a", "shopify"), row("b", "woocommerce")]
    state.stored.a = cfg("ta")
    state.stored.b = wcfg
    await mgr.applyAll()
    const rt = mgr.get("b")!.runtime as any
    rt.stop.mockRejectedValueOnce(new Error("x"))
    await expect(mgr.stopAll()).resolves.toBeUndefined()
    expect(mgr.list()).toEqual([])
  })

  it("stop is idempotent", async () => {
    const { mgr } = setup()
    state.rows = [row("a", "shopify")]
    state.stored.a = cfg("ta")
    await mgr.apply("a")
    const rt = mgr.get("a")!.runtime as any
    await mgr.stop("a")
    await mgr.stop("a")
    expect(rt.stop).toHaveBeenCalledTimes(1)
  })
})
