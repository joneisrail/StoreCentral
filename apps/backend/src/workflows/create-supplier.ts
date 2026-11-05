import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createSupplierStep,
  CreateSupplierStepInput,
} from "./steps/create-supplier"

export const createSupplierWorkflow = createWorkflow(
  "create-supplier",
  function (input: CreateSupplierStepInput) {
    const supplier = createSupplierStep(input)

    return new WorkflowResponse({ supplier })
  }
)

export default createSupplierWorkflow
