import { DelayedError, Queue, UnrecoverableError, Worker } from "bullmq"
import type { Job } from "bullmq"
import type { Redis as IORedis } from "ioredis"

/**
 * The four named BullMQ queues this app runs. Every later worker task
 * (product, inventory, price, order sync) hangs its processor off one of
 * these via `createSyncWorker`.
 */
export type SyncQueueName =
  | "product-sync"
  | "inventory-sync"
  | "price-sync"
  | "order-sync"
  | "shopify-inventory-sync"
  | "shopify-price-sync"
  | "shopify-order-sync"

const DEFAULT_ATTEMPTS = 5
// `jitter` is required by the plan's Global Constraints section
// ("exponential backoff + jitter") for every queue, not just this one's
// literal default — without it, BullMQ's exponential backoff
// (bullmq's `Backoffs.builtinStrategies.exponential`) fires every retrying
// job across all four queues at perfectly synchronized 1s/2s/4s/8s/16s
// marks, i.e. exactly the thundering-herd pattern jitter exists to avoid.
// 0.2 spreads each retry over +/-20% of its exponential delay.
const DEFAULT_BACKOFF = {
  type: "exponential" as const,
  delay: 1000,
  jitter: 0.2,
}

/**
 * A sync error that will fail identically no matter how many times it's
 * retried — e.g. a 4xx from Amazon's SP-API or the Medusa admin API (bad
 * request, permission denied, unknown resource). Throw this from a
 * processor passed to `createSyncWorker` to skip BullMQ's normal
 * attempts/backoff retry entirely and fail the job on the first attempt.
 *
 * Internally this is translated to BullMQ's own `UnrecoverableError`, which
 * `Job#shouldRetryJob` special-cases (`err.name == 'UnrecoverableError'`) to
 * never retry regardless of the job's configured `attempts`.
 */
export class PermanentSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PermanentSyncError"
    Object.setPrototypeOf(this, PermanentSyncError.prototype)
  }
}

/**
 * Thrown by a processor passed to `createSyncWorker` when the job can't make
 * progress *yet* and should simply run again at (or after) `retryAt` (epoch
 * ms) -- e.g. order import finding another attempt's still-live claim on the
 * same Amazon order (see `sync/import-order.ts`'s stale-`processing`
 * reclaim).
 *
 * Unlike a plain `Error`, this does not consume one of the job's
 * `attempts`: `createSyncWorker` moves the job to BullMQ's delayed set via
 * `job.moveToDelayed(retryAt, token)` and throws BullMQ's own
 * `DelayedError`, which BullMQ treats as "rescheduled", not "failed". That
 * matters when the wait has to outlast the whole exponential-backoff
 * schedule (1s..16s across 5 attempts, ~31s total) -- e.g. waiting out a
 * crashed caller's 5-minute claim lease -- which ordinary retries would
 * exhaust long before.
 */
export class DeferSyncError extends Error {
  readonly retryAt: number

  constructor(message: string, retryAt: number) {
    super(message)
    this.name = "DeferSyncError"
    this.retryAt = retryAt
    Object.setPrototypeOf(this, DeferSyncError.prototype)
  }
}

/**
 * Creates one of the four named BullMQ sync queues, with this plan's
 * default retry policy as the queue's `defaultJobOptions`: 5 attempts,
 * exponential backoff starting at 1s. Every job added to the queue without
 * its own `attempts`/`backoff` picks this policy up automatically.
 */
export const createSyncQueue = (
  name: SyncQueueName,
  connection: IORedis
): Queue => {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
    },
  })
}

/**
 * Creates a BullMQ worker for one of the four named sync queues.
 *
 * - A processor that throws `PermanentSyncError` gets converted to BullMQ's
 *   `UnrecoverableError` before BullMQ sees it, so the job fails on its
 *   first attempt no matter what `attempts` it was given.
 * - A processor that throws `DeferSyncError` gets its job moved to BullMQ's
 *   delayed set until the error's `retryAt`, without consuming an attempt.
 * - Any other thrown error is re-thrown unchanged, so BullMQ's normal
 *   attempts/backoff retry applies.
 * - `options.attempts` (default 5) lets a worker cap the number of attempts
 *   a job gets independent of whatever `attempts` the job itself carries
 *   (e.g. from the queue's `defaultJobOptions`). It's applied by setting
 *   `job.opts.attempts` on the live job object on every invocation, right
 *   before the processor runs: BullMQ's retry decision
 *   (`Job#shouldRetryJob`, called from `moveToFailed` on this same job
 *   instance after the processor throws) reads `this.opts.attempts`
 *   directly, so mutating it here is what the worker-level override is
 *   actually keying off.
 */
export const createSyncWorker = <T>(
  name: SyncQueueName,
  connection: IORedis,
  processor: (job: Job<T>) => Promise<void>,
  options?: { attempts?: number }
): Worker<T> => {
  const attempts = options?.attempts ?? DEFAULT_ATTEMPTS

  return new Worker<T>(
    name,
    async (job, token) => {
      job.opts.attempts = attempts
      try {
        await processor(job)
      } catch (err) {
        if (err instanceof Error && err.name === "PermanentSyncError") {
          throw new UnrecoverableError(err.message)
        }
        if (err instanceof DeferSyncError) {
          console.warn(
            `[${name}] deferring job ${job.id} until ` +
              `${new Date(err.retryAt).toISOString()}: ${err.message}`
          )
          await job.moveToDelayed(err.retryAt, token)
          throw new DelayedError()
        }
        throw err
      }
    },
    { connection }
  )
}
