import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { beforeEach, expect, test, vi } from "vitest"
import { startShopify, RECONCILE_SHOPIFY_JOB, type StartShopifyDeps } from "./bootstrap.js"

const mocks = vi.hoisted(() => ({
  processTracking: vi.fn(),
  link: vi.fn(),
  processOrder: vi.fn(),
}))

vi.mock("../sync/tracking/processor.js", async (orig) => ({
  ...(await orig<typeof import("../sync/tracking/processor.js")>()),
  processTrackingJob: mocks.processTracking,
}))
vi.mock("./account.js", () => ({
  resolveShopifyAccount: vi.fn(async () => ({ id: "acct-1", locationId: "loc" })),
}))
vi.mock("../sync/shopify-link.js", () => ({ linkShopifyVariants: mocks.link }))
vi.mock("../sync/shopify-order-sync-processor.js", () => ({
  processShopifyOrderSyncJob: mocks.processOrder,
}))

const linkResult = { linked: 2, alreadyLinked: 1, unmatched: [], duplicates: [] }

const setup = (extra: Partial<StartShopifyDeps> = {}) => {
  const queues: any[] = []
  const workers: Record<string, any> = {}
  const medusa = { findSalesChannelIdByName: vi.fn(async () => "sc_named") }
  const deps: StartShopifyDeps = {
    config: { shopDomain: "s.myshopify.com", accessToken: "t", webhookSecret: "w", locationId: "l" },
    pool: {} as Pool,
    medusaClient: medusa as any,
    encryptionKey: "00".repeat(32),
    redisConnection: {} as IORedis,
    reconcileIntervalMs: 1000,
    createQueue: ((name: string) => {
      const q = { name, add: vi.fn(async () => ({})), close: vi.fn(async () => {}), removeRepeatable: vi.fn(async () => true) }
      queues.push(q)
      return q
    }) as any,
    createWorker: ((name: string, _c: unknown, processor: any) => {
      const w = { name, processor, close: vi.fn(async () => {}) }
      workers[name] = w
      return w
    }) as any,
    ...extra,
  }
  return { deps, queues, workers, medusa }
}

beforeEach(() => {
  mocks.processTracking.mockReset().mockResolvedValue({ status: "skipped" })
  vi.spyOn(console, "log").mockImplementation(() => {})
  mocks.link.mockReset().mockResolvedValue(linkResult)
  mocks.processOrder.mockReset().mockResolvedValue({ status: "created" })
})

test("stop closes every worker and queue, removes the repeatable job, and is idempotent", async () => {
  const { deps, queues, workers } = setup()
  const rt = await startShopify(deps)
  await rt.stop()
  await rt.stop()
  expect(Object.keys(workers)).toHaveLength(4)
  for (const w of Object.values(workers)) expect(w.close).toHaveBeenCalledTimes(1)
  expect(queues).toHaveLength(4)
  for (const q of queues) expect(q.close).toHaveBeenCalledTimes(1)
  const inv = queues.find((q) => q.name === "shopify-inventory-sync")
  expect(inv.removeRepeatable).toHaveBeenCalledTimes(1)
  expect(inv.removeRepeatable).toHaveBeenCalledWith(RECONCILE_SHOPIFY_JOB, { every: 1000 })
})

test("stop keeps going when a close fails and logs only the message", async () => {
  const { deps, queues, workers } = setup()
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  const rt = await startShopify(deps)
  workers["shopify-order-sync"].close.mockRejectedValue(new Error("boom"))
  await expect(rt.stop()).resolves.toBeUndefined()
  expect(workers["shopify-price-sync"].close).toHaveBeenCalled()
  for (const q of queues) expect(q.close).toHaveBeenCalled()
  expect(JSON.stringify(err.mock.calls)).toContain("boom")
})

test("relink re-runs the link and returns its result", async () => {
  const { deps } = setup()
  const rt = await startShopify(deps)
  await rt.linked
  mocks.link.mockResolvedValue({ ...linkResult, linked: 5 })
  expect(await rt.relink()).toMatchObject({ linked: 5 })
  expect(mocks.link).toHaveBeenCalledTimes(2)
})

const resolveFrom = async (deps: StartShopifyDeps, workers: Record<string, any>) => {
  await startShopify(deps)
  await workers["shopify-order-sync"].processor({ name: "x", data: { shopifyOrderId: "1" } })
  return mocks.processOrder.mock.calls[0]![1].resolveSalesChannelId()
}

test("salesChannelId skips the name lookup", async () => {
  const { deps, workers, medusa } = setup({ salesChannelId: "sc_1" })
  expect(await resolveFrom(deps, workers)).toBe("sc_1")
  expect(medusa.findSalesChannelIdByName).not.toHaveBeenCalled()
})

test("without salesChannelId the Shopify name lookup still happens", async () => {
  const { deps, workers, medusa } = setup()
  expect(await resolveFrom(deps, workers)).toBe("sc_named")
  expect(medusa.findSalesChannelIdByName).toHaveBeenCalledWith("Shopify")
})

test("a failing boot link logs only a message string", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  const { deps } = setup()
  mocks.link.mockReset().mockRejectedValue(new Error("link boom"))
  const rt = await startShopify(deps)
  await rt.linked
  const call = err.mock.calls.find((c) => String(c[0]).includes("SKU link failed"))!
  expect(call[1]).toBe("link boom")
  expect(typeof call[1]).toBe("string")
  expect(JSON.stringify(err.mock.calls)).not.toContain("at ")
})

test("queue names include the account id", async () => {
  const { deps, queues, workers } = setup({ accountId: "acc-9" })
  await startShopify(deps)
  expect(queues.map((q) => q.name).sort()).toEqual([
    "shopify-inventory-sync-acc-9",
    "shopify-order-sync-acc-9",
    "shopify-price-sync-acc-9",
    "shopify-tracking-sync-acc-9",
  ])
  expect(Object.keys(workers).sort()).toEqual(queues.map((q) => q.name).sort())
})

test("accountId skips resolving the account", async () => {
  const account = await import("./account.js")
  const spy = (account as any).resolveShopifyAccount as ReturnType<typeof vi.fn>
  spy.mockClear()
  const { deps } = setup({ accountId: "acc-9" })
  await startShopify(deps)
  expect(spy).not.toHaveBeenCalled()
})

test("legacy start without accountId keeps the old queue names", async () => {
  const { deps, queues } = setup()
  await startShopify(deps)
  expect(queues.map((q) => q.name).sort()).toEqual([
    "shopify-inventory-sync",
    "shopify-order-sync",
    "shopify-price-sync",
    "shopify-tracking-sync",
  ])
})

test("tracking queue and worker are created per connection with the account-suffixed name and closed on stop", async () => {
  const { deps, queues, workers } = setup({ accountId: "acct-9" })
  const rt = await startShopify(deps)
  expect(queues.map((q) => q.name)).toContain("shopify-tracking-sync-acct-9")
  expect(workers["shopify-tracking-sync-acct-9"]).toBeDefined()
  expect(rt.webhook.trackingQueue).toBe(queues.find((q) => q.name === "shopify-tracking-sync-acct-9"))
  expect(rt.webhook.integrationAccountId).toBe("acct-9")
  await rt.stop()
  expect(workers["shopify-tracking-sync-acct-9"].close).toHaveBeenCalledTimes(1)
  expect(queues.find((q) => q.name === "shopify-tracking-sync-acct-9").close).toHaveBeenCalledTimes(1)
})

test("legacy start uses the unsuffixed tracking queue name", async () => {
  const { deps, queues } = setup()
  await startShopify(deps)
  expect(queues.map((q) => q.name)).toContain("shopify-tracking-sync")
})

test("the tracking worker runs processTrackingJob with the injected push, defaulting to a skipping no-op", async () => {
  const push = vi.fn(async () => "pushed" as const)
  const { deps, workers } = setup({ accountId: "acct-9", trackingPush: push })
  await startShopify(deps)
  await workers["shopify-tracking-sync-acct-9"].processor({
    name: "shipment.created",
    data: { fulfillmentId: "f", orderId: "o", noNotification: false },
  })
  expect(mocks.processTracking).toHaveBeenCalledWith(
    { fulfillmentId: "f", orderId: "o", noNotification: false },
    expect.objectContaining({ integrationAccountId: "acct-9", marketplace: "shopify", push })
  )
})
