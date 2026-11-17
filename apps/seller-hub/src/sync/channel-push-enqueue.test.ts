import type { Queue } from "bullmq"
import { expect, test, vi } from "vitest"
import {
  channelPushJobId,
  decideKind,
  enqueueChannelPush,
  widenKind,
} from "./channel-push-enqueue.js"

test("widenKind returns the union of two kinds", () => {
  expect(widenKind("stock", "stock")).toBe("stock")
  expect(widenKind("price", "price")).toBe("price")
  expect(widenKind("stock", "price")).toBe("both")
  expect(widenKind("price", "stock")).toBe("both")
  expect(widenKind("both", "stock")).toBe("both")
  expect(widenKind("stock", "both")).toBe("both")
})

test("decideKind drops the price part unless forced or auto-sync is on", () => {
  expect(decideKind("price", false, false)).toBeNull()
  expect(decideKind("both", false, false)).toBe("stock")
  expect(decideKind("stock", false, false)).toBe("stock")
  expect(decideKind("price", true, false)).toBe("price")
  expect(decideKind("both", true, false)).toBe("both")
  expect(decideKind("price", false, true)).toBe("price")
  expect(decideKind("both", false, true)).toBe("both")
})

test("the job id is prefixed (BullMQ rejects integer-only ids)", () => {
  expect(channelPushJobId("v1", "sc1")).toBe("channel-v1-sc1")
})

const fakeQueue = (existing: null | { state: string; data: any }) => {
  const updateData = vi.fn(async () => {})
  const job = existing
    ? { data: existing.data, getState: async () => existing.state, updateData }
    : null
  const queue = {
    add: vi.fn(async () => ({})),
    getJob: vi.fn(async () => job),
  }
  return { queue: queue as unknown as Queue, q: queue, updateData }
}

const data = { variantId: "v1", salesChannelId: "sc1", kind: "stock" as const, force: false }

test("adds a fresh job with the coalescing id and cleanup options", async () => {
  const { queue, q } = fakeQueue(null)
  await enqueueChannelPush(queue, data)
  expect(q.add).toHaveBeenCalledWith("channel-offer.changed", data, {
    jobId: "channel-v1-sc1",
    removeOnComplete: true,
    removeOnFail: true,
  })
})

test("a waiting job with a narrower kind is widened, not duplicated", async () => {
  const { queue, q, updateData } = fakeQueue({ state: "waiting", data })
  await enqueueChannelPush(queue, { ...data, kind: "price", force: true })
  expect(q.add).not.toHaveBeenCalled()
  expect(updateData).toHaveBeenCalledWith({ ...data, kind: "both", force: true })
})

test("a waiting job already covering the kind is left alone", async () => {
  const { queue, q, updateData } = fakeQueue({ state: "waiting", data: { ...data, kind: "both" } })
  await enqueueChannelPush(queue, data)
  expect(q.add).not.toHaveBeenCalled()
  expect(updateData).not.toHaveBeenCalled()
})

test("a non-waiting existing job falls through to add", async () => {
  const { queue, q, updateData } = fakeQueue({ state: "active", data })
  await enqueueChannelPush(queue, { ...data, kind: "price" })
  expect(updateData).not.toHaveBeenCalled()
  expect(q.add).toHaveBeenCalledTimes(1)
})

const twoSlotQueue = (jobs: Record<string, { state: string; data: any; failUpdate?: boolean }>) => {
  const updates: Record<string, any> = {}
  const queue = {
    add: vi.fn(async () => ({})),
    getJob: vi.fn(async (id: string) => {
      const j = jobs[id]
      if (!j) return null
      return {
        data: j.data,
        getState: async () => j.state,
        updateData: async (d: any) => {
          if (j.failUpdate) throw new Error("gone")
          updates[id] = d
        },
      }
    }),
  }
  return { queue: queue as unknown as Queue, q: queue, updates }
}

test("an active base job sends the change to the -next follow-up", async () => {
  const { queue, q } = twoSlotQueue({ "channel-v1-sc1": { state: "active", data } })
  await enqueueChannelPush(queue, { ...data, kind: "price", force: true })
  expect(q.add).toHaveBeenCalledWith(
    "channel-offer.changed",
    { ...data, kind: "price", force: true },
    { jobId: "channel-v1-sc1-next", removeOnComplete: true, removeOnFail: true }
  )
})

test("a waiting follow-up is widened (kind union, force OR) while base is active", async () => {
  const { queue, q, updates } = twoSlotQueue({
    "channel-v1-sc1": { state: "active", data },
    "channel-v1-sc1-next": { state: "waiting", data },
  })
  await enqueueChannelPush(queue, { ...data, kind: "price", force: true })
  expect(q.add).not.toHaveBeenCalled()
  expect(updates["channel-v1-sc1-next"]).toEqual({ ...data, kind: "both", force: true })
})

test("a waiting base is merged and the follow-up is not touched", async () => {
  const { queue, q, updates } = twoSlotQueue({ "channel-v1-sc1": { state: "waiting", data } })
  await enqueueChannelPush(queue, { ...data, kind: "price" })
  expect(updates["channel-v1-sc1"]).toMatchObject({ kind: "both" })
  expect(q.getJob).toHaveBeenCalledTimes(1)
  expect(q.add).not.toHaveBeenCalled()
})

test("a failing update (worker took the job) falls back to the follow-up id", async () => {
  const { queue, q } = twoSlotQueue({ "channel-v1-sc1": { state: "waiting", data, failUpdate: true } })
  await enqueueChannelPush(queue, { ...data, kind: "price" })
  expect(q.add).toHaveBeenCalledWith(
    "channel-offer.changed",
    expect.objectContaining({ kind: "price" }),
    expect.objectContaining({ jobId: "channel-v1-sc1-next" })
  )
})

test("when base and follow-up are both active a uniquely suffixed job is added", async () => {
  const { queue, q } = twoSlotQueue({
    "channel-v1-sc1": { state: "active", data },
    "channel-v1-sc1-next": { state: "active", data },
  })
  await enqueueChannelPush(queue, data)
  const opts = (q.add.mock.calls[0] as unknown[])[2] as { jobId: string }
  expect(opts.jobId).toMatch(/^channel-v1-sc1-next-\d+$/)
})
