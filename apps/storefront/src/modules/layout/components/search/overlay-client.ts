import {
  createEmptySearchResponse,
  parseSearchParams,
  type InstantSearchRequest,
} from "@medusajs/instantsearch-adapter"

import { searchClient } from "@lib/search-client"

const isBlank = (request: InstantSearchRequest) =>
  !parseSearchParams(request.params).query?.trim()

/**
 * The shared client, except that a blank query is answered locally: the
 * overlay shows suggestions, not hits, for an empty input, so opening it costs
 * no request. The listing keeps searching on an empty query.
 */
export const overlaySearchClient: typeof searchClient = {
  ...searchClient,
  search: (requests) =>
    requests.every(isBlank)
      ? Promise.resolve({ results: requests.map((request) => createEmptySearchResponse(request)) })
      : searchClient.search(requests),
}
