import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { normalizeQuery } from "./normalize"
import { createRateLimiter, type RateLimiter } from "./rate-limit"

export const SearchEventSchema = z.object({
  query: z.string().max(200),
  results: z.number().int().min(0).max(100000),
})

export const EVENTS_PER_MINUTE = 30


/**
 * Builds the POST /store/search/events handler. It always answers 200
 * `{ ok: true }`: invalid bodies, rate-limited clients and workflow failures
 * are swallowed (failures are logged) so a client never retry-loops.
 */
export function createRecordEventHandler(deps: {
  limiter: RateLimiter
  record: (req: MedusaRequest, input: { query: string; results: number }) => Promise<unknown>
}) {
  return async function handler(req: MedusaRequest, res: MedusaResponse) {
    try {
      const parsed = SearchEventSchema.safeParse(req.body)
      if (parsed.success) {
        const query = normalizeQuery(parsed.data.query)
        // req.ip honours Express "trust proxy" (Medusa sets it to 1: only the
        // last proxy hop is believed, a client-sent X-Forwarded-For prefix is
        // ignored). Without a proxy it is the socket address.
        const key = req.ip || "unknown"
        if (query && deps.limiter.allow(key)) {
          await deps.record(req, { query, results: parsed.data.results })
        }
      }
    } catch (error) {
      try {
        const logger = req.scope.resolve("logger") as {
          error: (m: string) => void
        }
        logger.error(
          `search event not recorded: ${error instanceof Error ? error.message : String(error)}`
        )
      } catch {
        // nothing more to do
      }
    }
    res.status(200).json({ ok: true })
  }
}

export function defaultLimiter(): RateLimiter {
  return createRateLimiter({ limit: EVENTS_PER_MINUTE, windowMs: 60_000 })
}
