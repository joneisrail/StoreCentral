import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  deleteExpenseStep,
  type DeleteExpenseStepInput,
} from "./steps/delete-expense"

export type DeleteExpenseWorkflowInput = DeleteExpenseStepInput

export const deleteExpenseWorkflow = createWorkflow(
  "delete-expense",
  function (input: DeleteExpenseWorkflowInput) {
    const expense = deleteExpenseStep(input)
    return new WorkflowResponse({ expense })
  }
)

export default deleteExpenseWorkflow
