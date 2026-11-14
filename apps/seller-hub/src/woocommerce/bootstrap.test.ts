import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { beforeEach, expect, test, vi } from "vitest"
import { startWooCommerce, RECONCILE_WOOCOMMERCE_JOB, type StartWooCommerceDeps } from "./bootstrap.js"

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
  resolveWooCommerceAccount: vi.fn(async () => ({ id: "acct-1", locationId: "loc" })),
}))
vi.mock("../sync/woocommerce-link.js", () => ({ linkWooCommerceListings: mocks.link }))
vi.mock("../sync/woocommerce-order-sync-processor.js", () => ({
  processWooOrderSyncJob: mocks.processOrder,
}))

const linkResult = { linked: 2, alreadyLinked: 1, unmatched: [], duplicates: [] }

const setup = (extra: Partial<StartWooCommerceDeps> = {}) => {
  const queues: any[] = []
  const workers: Record<string, any> = {}
  const medusa = { findSalesChannelIdByName: vi.fn(async () => "sc_named") }
  const deps: StartWooCommerceDeps = {
    config: { siteUrl: "https://s.example", consumerKey: "ck", consumerSecret: "cs", webhookSecret: "w" },
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
  const rt = await startWooCommerce(deps)
  await rt.stop()
  await rt.stop()
  expect(Object.keys(workers)).toHaveLength(4)
  for (const w of Object.values(workers)) expect(w.close).toHaveBeenCalledTimes(1)
  expect(queues).toHaveLength(4)
  for (const q of queues) expect(q.close).toHaveBeenCalledTimes(1)
  const inv = queues.find((q) => q.name === "woocommerce-inventory-sync")
  expect(inv.removeRepeatable).toHaveBeenCalledTimes(1)
  expect(inv.removeRepeatable).toHaveBeenCalledWith(RECONCILE_WOOCOMMERCE_JOB, { every: 1000 })
})

test("stop keeps going when a close fails and logs only the message", async () => {
  const { deps, queues, workers } = setup()
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  const rt = await startWooCommerce(deps)
  workers["woocommerce-order-sync"].close.mockRejectedValue(new Error("boom"))
  await expect(rt.stop()).resolves.toBeUndefined()
  expect(workers["woocommerce-price-sync"].close).toHaveBeenCalled()
  for (const q of queues) expect(q.close).toHaveBeenCalled()
  expect(JSON.stringify(err.mock.calls)).toContain("boom")
})

test("relink re-runs the link and returns its result", async () => {
  const { deps } = setup()
  const rt = await startWooCommerce(deps)
  await rt.linked
  mocks.link.mockResolvedValue({ ...linkResult, linked: 5 })
  expect(await rt.relink()).toMatchObject({ linked: 5 })
  expect(mocks.link).toHaveBeenCalledTimes(2)
})

const resolveFrom = async (deps: StartWooCommerceDeps, workers: Record<string, any>) => {
  await startWooCommerce(deps)
  await workers["woocommerce-order-sync"].processor({ name: "x", data: { wooOrderId: "1" } })
  return mocks.processOrder.mock.calls[0]![1].resolveSalesChannelId()
}

test("salesChannelId skips the name lookup", async () => {
  const { deps, workers, medusa } = setup({ salesChannelId: "sc_1" })
  expect(await resolveFrom(deps, workers)).toBe("sc_1")
  expect(medusa.findSalesChannelIdByName).not.toHaveBeenCalled()
})

test("without salesChannelId the WordPress name lookup still happens", async () => {
  const { deps, workers, medusa } = setup()
  expect(await resolveFrom(deps, workers)).toBe("sc_named")
  expect(medusa.findSalesChannelIdByName).toHaveBeenCalledWith("WordPress")
})

test("queue names include the account id", async () => {
  const { deps, queues, workers } = setup({ accountId: "acc-9" })
  await startWooCommerce(deps)
  expect(queues.map((q) => q.name).sort()).toEqual([
    "woocommerce-inventory-sync-acc-9",
    "woocommerce-order-sync-acc-9",
    "woocommerce-price-sync-acc-9",
    "woocommerce-tracking-sync-acc-9",
  ])
  expect(Object.keys(workers).sort()).toEqual(queues.map((q) => q.name).sort())
})

test("accountId skips resolving the account", async () => {
  const account = await import("./account.js")
  const spy = (account as any).resolveWooCommerceAccount as ReturnType<typeof vi.fn>
  spy.mockClear()
  const { deps } = setup({ accountId: "acc-9" })
  await startWooCommerce(deps)
  expect(spy).not.toHaveBeenCalled()
})

test("legacy start without accountId keeps the old queue names", async () => {
  const { deps, queues } = setup()
  await startWooCommerce(deps)
  expect(queues.map((q) => q.name).sort()).toEqual([
    "woocommerce-inventory-sync",
    "woocommerce-order-sync",
    "woocommerce-price-sync",
    "woocommerce-tracking-sync",
  ])
})

test("tracking queue and worker are created per connection with the account-suffixed name and closed on stop", async () => {
  const { deps, queues, workers } = setup({ accountId: "acct-9" })
  const rt = await startWooCommerce(deps)
  expect(queues.map((q) => q.name)).toContain("woocommerce-tracking-sync-acct-9")
  expect(workers["woocommerce-tracking-sync-acct-9"]).toBeDefined()
  expect(rt.webhook.trackingQueue).toBe(queues.find((q) => q.name === "woocommerce-tracking-sync-acct-9"))
  expect(rt.webhook.integrationAccountId).toBe("acct-9")
  await rt.stop()
  expect(workers["woocommerce-tracking-sync-acct-9"].close).toHaveBeenCalledTimes(1)
  expect(queues.find((q) => q.name === "woocommerce-tracking-sync-acct-9").close).toHaveBeenCalledTimes(1)
})

test("legacy start uses the unsuffixed tracking queue name", async () => {
  const { deps, queues } = setup()
  await startWooCommerce(deps)
  expect(queues.map((q) => q.name)).toContain("woocommerce-tracking-sync")
})

test("the tracking worker runs processTrackingJob with the injected push, defaulting to a skipping no-op", async () => {
  const push = vi.fn(async () => "pushed" as const)
  const { deps, workers } = setup({ accountId: "acct-9", trackingPush: push })
  await startWooCommerce(deps)
  await workers["woocommerce-tracking-sync-acct-9"].processor({
    name: "shipment.created",
    data: { fulfillmentId: "f", orderId: "o", noNotification: false },
  })
  expect(mocks.processTracking).toHaveBeenCalledWith(
    { fulfillmentId: "f", orderId: "o", noNotification: false },
    expect.objectContaining({ integrationAccountId: "acct-9", marketplace: "woocommerce", push })
  )
})
