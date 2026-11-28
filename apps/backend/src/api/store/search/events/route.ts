import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import recordSearchQueryWorkflow from "../../../../workflows/record-search-query"
import {
  countProductHits,
  createRecordEventHandler,
  defaultDeduper,
  defaultLimiter,
} from "../../../../modules/search-insights/record-event"

// Public (no auth). The limiter and the once-per-hour (IP, query) dedupe are
// per process: with several backend instances each enforces its own budget.
// The recorded result count is computed here, never taken from the client.
const handler = createRecordEventHandler({
  limiter: defaultLimiter(),
  dedupe: defaultDeduper(),
  count: countProductHits,
  record: (req, input) =>
    recordSearchQueryWorkflow(req.scope).run({ input }),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handler(req, res)
}
