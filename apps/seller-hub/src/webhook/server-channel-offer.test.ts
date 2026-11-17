import type { AddressInfo } from "node:net"
import type { Queue } from "bullmq"
import { afterEach, expect, test, vi } from "vitest"
import { createWebhookServer, type ShopifyWebhookDeps } from "./server.js"

type Existing = { state: string; data: any } | null

const fakeQueue = (existing: Existing = null) => {
  const updateData = vi.fn(async () => {})
  const job = existing
    ? { data: existing.data, getState: async () => existing.state, updateData }
    : null
  return {
    add: vi.fn(async () => ({})),
    getJob: vi.fn(async () => job),
    updateData,
  }
}

const makeConn = (
  id: string,
  salesChannelId: string | null,
  opts: { auto?: boolean; existing?: Existing; noPushQueue?: boolean } = {}
) => {
  const channelPush = fakeQueue(opts.existing ?? null)
  const deps = {
    webhookSecret: "s",
    orderQueue: { add: vi.fn() },
    inventoryQueue: { add: vi.fn() },
    priceQueue: { add: vi.fn() },
    trackingQueue: { add: vi.fn() },
    integrationAccountId: id,
    salesChannelId,
    autoSyncPrice: async () => opts.auto ?? false,
    ...(opts.noPushQueue ? {} : { channelPushQueue: channelPush as unknown as Queue }),
  } as unknown as ShopifyWebhookDeps
  return { deps, channelPush }
}

const servers: Array<{ close: () => void }> = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  vi.restoreAllMocks()
})

const start = (conns: Array<{ deps: ShopifyWebhookDeps }>, marketplace: "shopify" | "woocommerce" = "shopify") => {
  const amazon = {
    inventoryQueue: { add: vi.fn() } as unknown as Queue,
    priceQueue: { add: vi.fn() } as unknown as Queue,
  }
  const connectors = {
    get: () => null,
    all: (m: string) => (m === marketplace ? conns.map((c) => c.deps) : []),
  }
  const server = createWebhookServer({ ...amazon, connectors })
  server.listen(0)
  servers.push(server)
  return { amazon, url: `http://localhost:${(server.address() as AddressInfo).port}/webhooks/medusa` }
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

const evt = (data: Record<string, unknown>) => ({
  event: "channel-offer.changed",
  data: { variant_id: "v1", sales_channel_id: "sc1", kind: "stock", force: false, ...data },
})

test("routes only to the connection whose sales channel matches", async () => {
  const a = makeConn("acct-a", "sc1")
  const b = makeConn("acct-b", "sc2")
  const c = makeConn("acct-c", null)
  const { url, amazon } = start([a, b, c])
  const res = await post(url, evt({}))
  expect(res.status).toBe(200)
  expect(a.channelPush.add).toHaveBeenCalledTimes(1)
  expect(a.channelPush.add).toHaveBeenCalledWith(
    "channel-offer.changed",
    { variantId: "v1", salesChannelId: "sc1", kind: "stock", force: false },
    { jobId: "channel-v1-sc1", removeOnComplete: true, removeOnFail: true }
  )
  expect(b.channelPush.add).not.toHaveBeenCalled()
  expect(c.channelPush.add).not.toHaveBeenCalled()
  // Legacy variant-level queues are untouched.
  expect(a.deps.inventoryQueue.add).not.toHaveBeenCalled()
  expect(a.deps.priceQueue.add).not.toHaveBeenCalled()
  expect(amazon.inventoryQueue.add).not.toHaveBeenCalled()
  expect(amazon.priceQueue.add).not.toHaveBeenCalled()
})

test("no live connection for the channel is ignored with 200", async () => {
  const b = makeConn("acct-b", "sc2")
  const { url } = start([b])
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const res = await post(url, evt({}))
  expect(res.status).toBe(200)
  expect(b.channelPush.add).not.toHaveBeenCalled()
  expect(JSON.stringify(log.mock.calls)).toContain("channel-offer.changed")
})

test("a connection without a channel-push queue is skipped", async () => {
  const a = makeConn("acct-a", "sc1", { noPushQueue: true })
  const { url } = start([a])
  vi.spyOn(console, "log").mockImplementation(() => {})
  expect((await post(url, evt({}))).status).toBe(200)
})

test("price without force is dropped when auto sync is off", async () => {
  const a = makeConn("acct-a", "sc1", { auto: false })
  const { url } = start([a])
  expect((await post(url, evt({ kind: "price" }))).status).toBe(200)
  expect(a.channelPush.add).not.toHaveBeenCalled()
})

test("both without force and auto off becomes a stock-only job", async () => {
  const a = makeConn("acct-a", "sc1", { auto: false })
  const { url } = start([a])
  await post(url, evt({ kind: "both" }))
  expect(a.channelPush.add).toHaveBeenCalledWith(
    "channel-offer.changed",
    expect.objectContaining({ kind: "stock", force: false }),
    expect.anything()
  )
})

test("force keeps the price part", async () => {
  const a = makeConn("acct-a", "sc1", { auto: false })
  const { url } = start([a])
  await post(url, evt({ kind: "price", force: true, manual: true }))
  expect(a.channelPush.add).toHaveBeenCalledWith(
    "channel-offer.changed",
    { variantId: "v1", salesChannelId: "sc1", kind: "price", force: true },
    expect.anything()
  )
})

test("auto sync keeps the price part without force", async () => {
  const a = makeConn("acct-a", "sc1", { auto: true })
  const { url } = start([a])
  await post(url, evt({ kind: "both" }))
  expect(a.channelPush.add).toHaveBeenCalledWith(
    "channel-offer.changed",
    expect.objectContaining({ kind: "both" }),
    expect.anything()
  )
})

test("a waiting job is widened to the union instead of adding another", async () => {
  const a = makeConn("acct-a", "sc1", {
    auto: true,
    existing: {
      state: "waiting",
      data: { variantId: "v1", salesChannelId: "sc1", kind: "stock", force: false },
    },
  })
  const { url } = start([a])
  await post(url, evt({ kind: "price" }))
  expect(a.channelPush.add).not.toHaveBeenCalled()
  expect(a.channelPush.updateData).toHaveBeenCalledWith({
    variantId: "v1",
    salesChannelId: "sc1",
    kind: "both",
    force: false,
  })
})

test("an enqueue failure on one connection does not block the others", async () => {
  const a = makeConn("acct-a", "sc1")
  const b = makeConn("acct-b", "sc1")
  a.channelPush.add.mockRejectedValue(new Error("redis down"))
  const { url } = start([a, b])
  vi.spyOn(console, "error").mockImplementation(() => {})
  expect((await post(url, evt({}))).status).toBe(200)
  expect(b.channelPush.add).toHaveBeenCalledTimes(1)
})

test.each([
  ["missing variant_id", { variant_id: undefined }],
  ["empty sales_channel_id", { sales_channel_id: "" }],
  ["numeric variant_id", { variant_id: 5 }],
  ["bad kind", { kind: "everything" }],
  ["non-boolean force", { force: "yes" }],
  ["missing force", { force: undefined }],
])("malformed channel-offer.changed (%s) returns 400", async (_n, patch) => {
  const a = makeConn("acct-a", "sc1")
  const { url } = start([a])
  const res = await post(url, evt(patch))
  expect(res.status).toBe(400)
  expect(a.channelPush.add).not.toHaveBeenCalled()
})

test("channel-offer.changed without a data object returns 400", async () => {
  const a = makeConn("acct-a", "sc1")
  const { url } = start([a])
  expect((await post(url, { event: "channel-offer.changed" })).status).toBe(400)
})

test("woocommerce connections for the channel are also targeted", async () => {
  const w = makeConn("woo-1", "sc1")
  const { url } = start([w], "woocommerce")
  await post(url, evt({}))
  expect(w.channelPush.add).toHaveBeenCalledTimes(1)
})
