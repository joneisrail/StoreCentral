import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { MeilisearchSearchService } from "./services/meilisearch-search"

const services = [MeilisearchSearchService]

export default ModuleProvider(Modules.SEARCH, {
  services,
})
