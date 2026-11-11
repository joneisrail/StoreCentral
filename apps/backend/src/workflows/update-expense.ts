import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  updateExpenseStep,
  type UpdateExpenseStepInput,
} from "./steps/update-expense"

export type UpdateExpenseWorkflowInput = UpdateExpenseStepInput

export const updateExpenseWorkflow = createWorkflow(
  "update-expense",
  function (input: UpdateExpenseWorkflowInput) {
    const expense = updateExpenseStep(input)
    return new WorkflowResponse({ expense })
  }
)

export default updateExpenseWorkflow
