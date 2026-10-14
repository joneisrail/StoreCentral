import { Queue, UnrecoverableError, Worker } from "bullmq"
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

const DEFAULT_ATTEMPTS = 5
const DEFAULT_BACKOFF = { type: "exponential" as const, delay: 1000 }

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
    async (job) => {
      job.opts.attempts = attempts
      try {
        await processor(job)
      } catch (err) {
        if (err instanceof Error && err.name === "PermanentSyncError") {
          throw new UnrecoverableError(err.message)
        }
        throw err
      }
    },
    { connection }
  )
}
