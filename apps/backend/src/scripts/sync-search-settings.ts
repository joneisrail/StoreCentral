/**
 * Re-applies the Meilisearch settings and synonyms of the product index to the
 * physical index that is serving reads now, without recreating or reseeding
 * it. Editing `synonyms.ts` (or index settings that keep the schema hash)
 * changes nothing on a live index by itself; run this after such an edit:
 *
 *   npx medusa exec ./src/scripts/sync-search-settings.ts
 *
 * It goes through the provider's `upsertIndex`, which for an existing index
 * with the same primary key only updates settings and synonyms (and waits for
 * the tasks). Logs the index name and counts only, never the API key.
 */
import { Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import { countSynonymGroups, SYNONYMS } from "../providers/search-meilisearch/utils/synonyms"

const INDEX_NAME = "product"

export default async function syncSearchSettings({ container }: ExecArgs) {
  // `resolveActiveDefinition_` and `searchProviderService_` are protected on
  // the Search Module service and nothing public returns the active physical
  // name, so they are read at runtime.
  const searchModule = container.resolve(Modules.SEARCH) as any

  const definition = await searchModule.resolveActiveDefinition_(INDEX_NAME, {
    fresh: true,
  })

  if (definition.provider !== "meilisearch") {
    throw new Error(
      `Index "${INDEX_NAME}" is served by "${definition.provider}", not meilisearch.`,
    )
  }

  const provider = searchModule.searchProviderService_.retrieve(definition.provider)
  await provider.upsertIndex({ index: definition })

  console.log(
    `Applied settings and ${countSynonymGroups(SYNONYMS)} synonym groups to Meilisearch index "${definition.physical_name}".`,
  )
}
