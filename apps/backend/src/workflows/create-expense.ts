import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createExpenseStep,
  type CreateExpenseStepInput,
} from "./steps/create-expense"

export type CreateExpenseWorkflowInput = CreateExpenseStepInput

export const createExpenseWorkflow = createWorkflow(
  "create-expense",
  function (input: CreateExpenseWorkflowInput) {
    const expense = createExpenseStep(input)
    return new WorkflowResponse({ expense })
  }
)

export default createExpenseWorkflow
