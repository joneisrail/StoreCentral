import { Redis as IORedis } from "ioredis"
import type { SellerHubEnv } from "../env.js"

/**
 * Creates an `ioredis` connection configured the way BullMQ requires.
 *
 * BullMQ's `Worker` and `QueueEvents` issue blocking Redis commands
 * internally, and throw at construction time if a pre-built `ioredis`
 * instance handed to them has `maxRetriesPerRequest` set to anything other
 * than `null` (see bullmq's `classes/redis-connection.js`). Setting it here
 * means the same connection returned by this function can be safely shared
 * across a `Queue`, `Worker`, and `QueueEvents` for a given sync queue.
 */
export const createRedisConnection = (env: SellerHubEnv): IORedis => {
  return new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
  })
}
