import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { normalizeQuery } from "./normalize"
import {
  createQueryDeduper,
  createRateLimiter,
  type QueryDeduper,
  type RateLimiter,
} from "./rate-limit"

export const SearchEventSchema = z.object({
  query: z.string().max(200),
  // Still accepted (and validated) so older storefront builds keep working,
  // but never used: the count is computed on the server, see `countProductHits`.
  results: z.number().int().min(0).max(100000),
})

export const EVENTS_PER_MINUTE = 30
export const DEDUPE_WINDOW_MS = 60 * 60_000

type Logger = { error: (m: string) => void; warn: (m: string) => void }

function logger(req: MedusaRequest): Logger | undefined {
  try {
    return req.scope.resolve("logger") as Logger
  } catch {
    return undefined
  }
}

/**
 * Builds the POST /store/search/events handler. It always answers 200
 * `{ ok: true }`: invalid bodies, rate-limited or repeated events and failures
 * are swallowed (failures are logged) so a client never retry-loops.
 *
 * The client only says WHAT was searched. How many products match is counted
 * here, so a client cannot record a fake result count, and each (IP, query)
 * pair counts at most once per hour, so one client cannot inflate a query.
 */
export function createRecordEventHandler(deps: {
  limiter: RateLimiter
  dedupe: QueryDeduper
  count: (req: MedusaRequest, query: string) => Promise<number>
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
        const pair = `${key} ${query}`
        if (query && deps.limiter.allow(key) && deps.dedupe.claim(pair)) {
          let results: number
          try {
            results = await deps.count(req, query)
          } catch (error) {
            deps.dedupe.release(pair)
            logger(req)?.warn(
              `search event not recorded, result count failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
            res.status(200).json({ ok: true })
            return
          }
          try {
            await deps.record(req, { query, results })
          } catch (error) {
            deps.dedupe.release(pair)
            throw error
          }
        }
      }
    } catch (error) {
      logger(req)?.error(
        `search event not recorded: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    res.status(200).json({ ok: true })
  }
}

/**
 * Counts the published products matching `query` in the request's
 * publishable-key sales channels, the way /store/search scopes the product
 * index (same `match_strategy` as the storefront's search client, so the count
 * equals the unfiltered hit count the /search page shows). Asks for no hits,
 * only the total.
 */
export async function countProductHits(
  req: MedusaRequest,
  query: string
): Promise<number> {
  const searchModule = req.scope.resolve(Modules.SEARCH) as {
    search: (q: unknown) => Promise<{ metadata?: { count?: number | null } }>
  }
  const salesChannelIds =
    (req as { publishable_key_context?: { sales_channel_ids?: string[] } })
      .publishable_key_context?.sales_channel_ids ?? []

  const result = await searchModule.search({
    entity: "product",
    fields: ["id"],
    filters: {
      q: query,
      status: ProductStatus.PUBLISHED,
      ...(salesChannelIds.length ? { sales_channel_ids: salesChannelIds } : {}),
    },
    pagination: { skip: 0, take: 0 },
    search_options: { match_strategy: "last" },
  })
  const count = result?.metadata?.count
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new Error("the search engine returned no count")
  }
  return Math.max(0, Math.trunc(count))
}

export function defaultLimiter(): RateLimiter {
  return createRateLimiter({ limit: EVENTS_PER_MINUTE, windowMs: 60_000 })
}

export function defaultDeduper(): QueryDeduper {
  return createQueryDeduper({ windowMs: DEDUPE_WINDOW_MS })
}
