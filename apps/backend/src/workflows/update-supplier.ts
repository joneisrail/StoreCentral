import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  updateSupplierStep,
  UpdateSupplierStepInput,
} from "./steps/update-supplier"

export const updateSupplierWorkflow = createWorkflow(
  "update-supplier",
  function (input: UpdateSupplierStepInput) {
    const supplier = updateSupplierStep(input)

    return new WorkflowResponse({ supplier })
  }
)

export default updateSupplierWorkflow
