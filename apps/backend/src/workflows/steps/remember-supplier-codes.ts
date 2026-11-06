import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createSupplierProductWorkflow } from "../create-supplier-product"
import { deleteSupplierProductWorkflow } from "../delete-supplier-product"

export type RememberSupplierCodesStepInput = {
  supplier_id: string
  entries: { variant_id: string; supplier_sku: string }[]
}

export type RememberSupplierCodesStepOutput = {
  supplier_product_ids: string[]
}

type Created = { supplier_id: string; ids: string[] }

const forgetCodes = async (
  container: MedusaContainer,
  created: Created
) => {
  // Newest first, so a failure part-way leaves the oldest entries.
  for (const id of [...created.ids].reverse()) {
    await deleteSupplierProductWorkflow(container).run({
      input: { id, supplier_id: created.supplier_id },
    })
  }
}

// Adds each code to the supplier's product list with the existing workflow, so
// the list's own validation and messages apply. One step loops over the
// entries because a workflow body cannot loop. If an entry fails, the ones
// added before it are removed here, since a failed step is not compensated.
export const rememberSupplierCodesStep = createStep(
  "remember-supplier-codes",
  async (input: RememberSupplierCodesStepInput, { container }) => {
    const created: Created = { supplier_id: input.supplier_id, ids: [] }

    try {
      for (const entry of input.entries) {
        const { result } = await createSupplierProductWorkflow(container).run({
          input: {
            supplier_id: input.supplier_id,
            variant_id: entry.variant_id,
            supplier_sku: entry.supplier_sku,
          },
        })
        created.ids.push(result.supplier_product.id)
      }
    } catch (err) {
      await forgetCodes(container, created)
      throw err
    }

    const output: RememberSupplierCodesStepOutput = {
      supplier_product_ids: created.ids,
    }
    return new StepResponse(output, created)
  },
  async (created, { container }) => {
    if (!created?.ids.length) {
      return
    }
    await forgetCodes(container, created)
  }
)
