import {
  generateEntityId,
  InjectManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"
import SearchQuery from "./models/search-query"

class SearchInsightsModuleService extends MedusaService({
  SearchQuery,
}) {
  /**
   * Atomic upsert in one SQL statement: a new query starts at count 1, an
   * existing one is incremented in the database (not read-modify-write), so
   * concurrent requests never lose a count. The conflict target matches the
   * partial unique index Medusa creates for `query` (live rows only).
   * `results_count` keeps the last seen value.
   */
  @InjectManager()
  async recordQuery(
    input: { query: string; results: number },
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const manager = (sharedContext as any).manager
    await manager.execute(
      `insert into "search_query" ("id", "query", "count", "last_seen_at", "results_count", "created_at", "updated_at")
       values (?, ?, 1, now(), ?, now(), now())
       on conflict ("query") where deleted_at is null
       do update set "count" = "search_query"."count" + 1,
         "last_seen_at" = now(),
         "results_count" = excluded."results_count",
         "updated_at" = now()`,
      [generateEntityId(undefined, "sq"), input.query, input.results]
    )
  }
}

export default SearchInsightsModuleService
