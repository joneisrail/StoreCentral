import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  recordSearchQueryStep,
  type RecordSearchQueryInput,
} from "./steps/record-search-query"

// Input must already be normalized (see normalizeQuery).
const recordSearchQueryWorkflow = createWorkflow(
  "record-search-query",
  function (input: RecordSearchQueryInput) {
    return new WorkflowResponse(recordSearchQueryStep(input))
  }
)

export default recordSearchQueryWorkflow
