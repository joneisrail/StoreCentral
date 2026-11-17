import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { beforeEach, expect, test, vi } from "vitest"
import { startWooCommerce, RECONCILE_WOOCOMMERCE_JOB, type StartWooCommerceDeps } from "./bootstrap.js"

const mocks = vi.hoisted(() => ({
  processTracking: vi.fn(),
  link: vi.fn(),
  processOrder: vi.fn(),
  channelPush: vi.fn(),
  setStock: vi.fn(),
  setPrice: vi.fn(),
}))

vi.mock("../sync/channel-push.js", () => ({ processChannelPushJob: mocks.channelPush }))
vi.mock("./products.js", () => ({ setWooStock: mocks.setStock, setWooPrice: mocks.setPrice }))

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
  mocks.channelPush.mockReset().mockResolvedValue(undefined)
  mocks.setStock.mockReset().mockResolvedValue(undefined)
  mocks.setPrice.mockReset().mockResolvedValue(undefined)
})

test("stop closes every worker and queue, removes the repeatable job, and is idempotent", async () => {
  const { deps, queues, workers } = setup()
  const rt = await startWooCommerce(deps)
  await rt.stop()
  await rt.stop()
  expect(Object.keys(workers)).toHaveLength(5)
  for (const w of Object.values(workers)) expect(w.close).toHaveBeenCalledTimes(1)
  expect(queues).toHaveLength(5)
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
    "woocommerce-channel-push-acc-9",
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
    "woocommerce-channel-push",
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

test("the tracking worker runs processTrackingJob with the injected push, ", async () => {
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

test("without an injected push the tracking worker gets the WooCommerce push bound to the client", async () => {
  const urls: string[] = []
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(url.includes("/notes") ? [] : { status: "completed" }), { status: 200 })
  })
  const { deps, workers } = setup({ accountId: "acct-9", fetchImpl: fetchImpl as any })
  await startWooCommerce(deps)
  await workers["woocommerce-tracking-sync-acct-9"].processor({
    name: "shipment.created",
    data: { fulfillmentId: "f", orderId: "o", noNotification: false },
  })
  const passed = mocks.processTracking.mock.calls[0][1].push
  fetchImpl.mockClear()
  urls.length = 0
  await passed({
    order: { id: "o", metadata: {}, items: [], fulfillments: [] },
    fulfillment: {
      id: "f", canceledAt: null, items: [], carrier: null,
      labels: [{ trackingNumber: "T1", trackingUrl: null }],
    },
    externalOrderId: "55",
    noNotification: false,
  })
  expect(urls[0]).toBe("https://s.example/wp-json/wc/v3/orders/55")
})

test("a channel-push queue and worker are created, exposed on the webhook deps and closed on stop", async () => {
  const { deps, queues, workers } = setup({ accountId: "acct-9", salesChannelId: "sc_9" })
  const rt = await startWooCommerce(deps)
  expect((rt.webhook.channelPushQueue as any).name).toBe("woocommerce-channel-push-acct-9")
  expect(workers["woocommerce-channel-push-acct-9"]).toBeDefined()
  expect(rt.webhook.salesChannelId).toBe("sc_9")
  await rt.stop()
  expect(queues.find((x) => x.name === "woocommerce-channel-push-acct-9").close).toHaveBeenCalledTimes(1)
  expect(workers["woocommerce-channel-push-acct-9"].close).toHaveBeenCalledTimes(1)
})

test("autoSyncPrice reads integration_account.auto_sync_price at call time", async () => {
  const rows = [{ auto_sync_price: false }]
  const query = vi.fn(async (..._a: unknown[]) => ({ rows: [...rows] }))
  const { deps } = setup({ accountId: "acct-9", pool: { query } as unknown as Pool })
  const rt = await startWooCommerce(deps)
  expect(await rt.webhook.autoSyncPrice!()).toBe(false)
  rows[0]!.auto_sync_price = true
  expect(await rt.webhook.autoSyncPrice!()).toBe(true)
  expect(query).toHaveBeenCalledWith(expect.stringContaining("auto_sync_price"), ["acct-9"])
})

const runChannelPush = async (
  extra: Partial<StartWooCommerceDeps>,
  job: Record<string, unknown> = { attemptsMade: 0, opts: { attempts: 3 } }
) => {
  const ctx = setup({ accountId: "acct-9", ...extra })
  await startWooCommerce(ctx.deps)
  await ctx.workers["woocommerce-channel-push-acct-9"].processor({
    name: "channel-offer.changed",
    data: { variantId: "v1", salesChannelId: "sc_9", kind: "both", force: false },
    ...job,
  })
  return { ...ctx, passed: mocks.channelPush.mock.calls[0]![1] }
}

const listing = (over: Record<string, unknown> = {}) => ({
  id: "cl1", medusa_variant_id: "v1", external_sku: "S", external_variant_id: "77",
  external_inventory_item_id: null, external_parent_id: null, price_rule: null, ...over,
})

test("the channel-push worker runs processChannelPushJob for the account and flags the final attempt", async () => {
  const { passed } = await runChannelPush({}, { attemptsMade: 2, opts: { attempts: 3 } })
  expect(mocks.channelPush.mock.calls[0]![0]).toEqual({ variantId: "v1", salesChannelId: "sc_9", kind: "both", force: false })
  expect(passed).toMatchObject({ integrationAccountId: "acct-9", finalAttempt: true })
  mocks.channelPush.mockClear()
  const again = await runChannelPush({}, { attemptsMade: 0, opts: { attempts: 3 } })
  expect(again.passed.finalAttempt).toBe(false)
})

test("pushStock sets the WooCommerce stock of a simple product", async () => {
  const { passed } = await runChannelPush({})
  await passed.pushStock(listing(), 4)
  expect(mocks.setStock).toHaveBeenCalledWith(expect.anything(), { id: 77, parentId: null, quantity: 4 })
})

test("pushStock addresses a variation through external_parent_id", async () => {
  const { passed } = await runChannelPush({})
  await passed.pushStock(listing({ external_parent_id: "50" }), 2)
  expect(mocks.setStock).toHaveBeenCalledWith(expect.anything(), { id: 77, parentId: 50, quantity: 2 })
})

test("pushStock and pushPrice fail permanently without a WooCommerce id or with a bad id", async () => {
  const { passed } = await runChannelPush({})
  for (const bad of [{ external_variant_id: null }, { external_variant_id: "abc" }, { external_parent_id: "x" }]) {
    await expect(passed.pushStock(listing(bad), 1)).rejects.toMatchObject({ name: "PermanentSyncError" })
    await expect(passed.pushPrice(listing(bad), 1)).rejects.toMatchObject({ name: "PermanentSyncError" })
  }
  expect(mocks.setStock).not.toHaveBeenCalled()
  expect(mocks.setPrice).not.toHaveBeenCalled()
})

test("pushPrice sends the channel price as a 2-decimal string when the store currency is USD", async () => {
  const { passed, medusa } = await runChannelPush({})
  ;(medusa as any).getVariantPricing = vi.fn(async () => ({ amount: 1, currencyCode: "USD" }))
  await passed.pushPrice(listing({ external_parent_id: "50" }), 12.5)
  expect(mocks.setPrice).toHaveBeenCalledWith(expect.anything(), { id: 77, parentId: 50, price: "12.50" })
})

test("pushPrice is a permanent failure for a non-USD store currency and pushes nothing", async () => {
  const { passed, medusa } = await runChannelPush({})
  ;(medusa as any).getVariantPricing = vi.fn(async () => ({ amount: 1, currencyCode: "eur" }))
  await expect(passed.pushPrice(listing(), 12.5)).rejects.toMatchObject({ name: "PermanentSyncError" })
  expect(mocks.setPrice).not.toHaveBeenCalled()
})
