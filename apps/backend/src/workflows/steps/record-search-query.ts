import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SEARCH_INSIGHTS_MODULE } from "../../modules/search-insights"
import type SearchInsightsModuleService from "../../modules/search-insights/service"

export type RecordSearchQueryInput = { query: string; results: number }

export async function recordSearchQuery(
  service: Pick<SearchInsightsModuleService, "recordQuery">,
  input: RecordSearchQueryInput
): Promise<RecordSearchQueryInput> {
  await service.recordQuery({ query: input.query, results: input.results })
  return input
}

// No compensation: a counter bump is harmless to leave in place and there is
// nothing to roll back to.
export const recordSearchQueryStep = createStep(
  "record-search-query",
  async (input: RecordSearchQueryInput, { container }) => {
    const service = container.resolve<SearchInsightsModuleService>(
      SEARCH_INSIGHTS_MODULE
    )
    return new StepResponse(await recordSearchQuery(service, input))
  }
)
