import { afterEach, expect, test } from "vitest"
import { QueueEvents } from "bullmq"
import { loadEnv } from "../env.js"
import { waitFor } from "../test-support/wait-for.js"
import { createRedisConnection } from "./connection.js"
import {
  createSyncQueue,
  createSyncWorker,
  DeferSyncError,
  PermanentSyncError,
} from "./queues.js"

// Every resource a test creates (connection, queue, worker, QueueEvents) is
// registered here and torn down in `afterEach`, in reverse (LIFO) order, so
// a failing assertion never leaks a live Redis connection or a running
// worker and hangs the test process. Consumers (QueueEvents/Worker/Queue)
// are always closed before the shared `connection` they were given is
// quit, since they depend on it.
let cleanupFns: (() => Promise<unknown>)[] = []
const registerCleanup = (fn: () => Promise<unknown>) => {
  cleanupFns.push(fn)
}
afterEach(async () => {
  for (const fn of cleanupFns.reverse()) {
    await fn()
  }
  cleanupFns = []
})

test(
  "a processor that fails twice then succeeds eventually completes the job",
  async () => {
    const connection = createRedisConnection(loadEnv())
    registerCleanup(() => connection.quit())

    const queue = createSyncQueue("inventory-sync", connection)
    registerCleanup(() => queue.close())

    let attempts = 0
    const worker = createSyncWorker(
      "inventory-sync",
      connection,
      async () => {
        attempts++
        if (attempts < 3) throw new Error("transient")
      },
      { attempts: 5 }
    )
    registerCleanup(() => worker.close())

    const events = new QueueEvents("inventory-sync", { connection })
    registerCleanup(() => events.close())
    // Subscribed before the job exists, so a fast completion can never be missed.
    await events.waitUntilReady()

    const job = await queue.add("test", { foo: "bar" })
    await job.waitUntilFinished(events)

    expect(attempts).toBe(3)
  },
  15_000
)

test(
  "a processor that throws PermanentSyncError is not retried",
  async () => {
    const connection = createRedisConnection(loadEnv())
    registerCleanup(() => connection.quit())

    const queue = createSyncQueue("price-sync", connection)
    registerCleanup(() => queue.close())

    let attempts = 0
    const worker = createSyncWorker("price-sync", connection, async () => {
      attempts++
      throw new PermanentSyncError("bad request")
    })
    registerCleanup(() => worker.close())

    const events = new QueueEvents("price-sync", { connection })
    registerCleanup(() => events.close())
    // Subscribed before the job exists, so a fast completion can never be missed.
    await events.waitUntilReady()

    const job = await queue.add("test", {})
    await expect(job.waitUntilFinished(events)).rejects.toThrow()
    expect(attempts).toBe(1) // no retry
  },
  15_000
)

test(
  "a processor that always throws a transient error exhausts its attempts and the job ends failed",
  async () => {
    const connection = createRedisConnection(loadEnv())
    registerCleanup(() => connection.quit())

    const queue = createSyncQueue("order-sync", connection)
    registerCleanup(() => queue.close())

    let attempts = 0
    const worker = createSyncWorker(
      "order-sync",
      connection,
      async () => {
        attempts++
        throw new Error("still transient")
      },
      { attempts: 3 }
    )
    registerCleanup(() => worker.close())

    const events = new QueueEvents("order-sync", { connection })
    registerCleanup(() => events.close())
    // Subscribed before the job exists, so a fast completion can never be missed.
    await events.waitUntilReady()

    const job = await queue.add("test", {})
    await expect(job.waitUntilFinished(events)).rejects.toThrow()
    expect(attempts).toBe(3) // exhausted the attempt cap, then stopped — not infinite

    await waitFor(async () => (await job.getState()) === "failed")
    expect(await job.getState()).toBe("failed")
  },
  15_000
)

test(
  "a processor that throws DeferSyncError is re-run after retryAt without consuming an attempt",
  async () => {
    const connection = createRedisConnection(loadEnv())
    registerCleanup(() => connection.quit())

    const queue = createSyncQueue("product-sync", connection)
    registerCleanup(() => queue.close())

    // Long enough that the job is still observably delayed on the next poll
    // even under load; the test asserts ordering and counts, never elapsed ms.
    let runs = 0
    const worker = createSyncWorker(
      "product-sync",
      connection,
      async () => {
        runs++
        if (runs === 1) {
          throw new DeferSyncError("not yet", Date.now() + 2000)
        }
      },
      // A single attempt: if the deferral were counted as a failed attempt,
      // the job would end `failed` instead of ever running a second time.
      { attempts: 1 }
    )
    registerCleanup(() => worker.close())

    const events = new QueueEvents("product-sync", { connection })
    registerCleanup(() => events.close())
    await events.waitUntilReady()

    const job = await queue.add("test", {})

    // Deferred, not failed: the job parks in the delayed set after run 1 and
    // has not been re-run yet.
    await waitFor(async () => (await job.getState()) === "delayed")
    expect(runs).toBe(1)

    await job.waitUntilFinished(events)

    expect(runs).toBe(2)
    expect(await job.getState()).toBe("completed")
  },
  15_000
)
