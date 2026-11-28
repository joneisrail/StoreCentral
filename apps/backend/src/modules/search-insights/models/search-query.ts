import { model } from "@medusajs/framework/utils"

const SearchQuery = model.define("search_query", {
  id: model.id().primaryKey(),
  query: model.text().unique(),
  count: model.number().default(1),
  last_seen_at: model.dateTime(),
  results_count: model.number().default(0),
})

export default SearchQuery
