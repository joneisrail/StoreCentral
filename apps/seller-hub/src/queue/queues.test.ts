import { afterEach, expect, test } from "vitest"
import { QueueEvents } from "bullmq"
import { loadEnv } from "../env.js"
import { createRedisConnection } from "./connection.js"
import {
  createSyncQueue,
  createSyncWorker,
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

    const job = await queue.add("test", {})
    await expect(job.waitUntilFinished(events)).rejects.toThrow()
    expect(attempts).toBe(3) // exhausted the attempt cap, then stopped — not infinite

    const finalState = await job.getState()
    expect(finalState).toBe("failed")
  },
  15_000
)
