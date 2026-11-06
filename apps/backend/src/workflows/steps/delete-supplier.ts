import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"
import { toSupplierProductSnapshot } from "./delete-supplier-product"

export type DeleteSupplierStepInput = {
  id: string
}

// Read-only: 404 for a bad id, refuses a supplier with purchases, and
// snapshots its product entries so the workflow can unlink and delete them
// (the supplier row cannot be deleted while entries reference it).
export const validateSupplierDeletionStep = createStep(
  "validate-supplier-deletion",
  async (input: DeleteSupplierStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // A bad id throws NOT_FOUND here (404).
    await supplierModule.retrieveSupplier(input.id)

    const { data } = await query.graph({
      entity: "supplier",
      fields: ["id", "purchases.id"],
      filters: { id: input.id },
    })
    if (data[0]?.purchases?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Supplier has purchases and cannot be deleted"
      )
    }

    const entries = await supplierModule.listSupplierProducts(
      { supplier_id: input.id },
      { take: null }
    )

    return new StepResponse(
      entries.map((entry) => toSupplierProductSnapshot(entry, input.id))
    )
  }
)

export const deleteSupplierStep = createStep(
  "delete-supplier",
  async (input: DeleteSupplierStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    const existing = await supplierModule.retrieveSupplier(input.id)

    await supplierModule.deleteSuppliers(input.id)

    return new StepResponse(
      { id: input.id },
      {
        id: existing.id,
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
        address: existing.address,
        notes: existing.notes,
        contact_name: existing.contact_name,
        website: existing.website,
        tax_id: existing.tax_id,
        payment_terms: existing.payment_terms,
        lead_time_days: existing.lead_time_days,
        is_active: existing.is_active,
      }
    )
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.createSuppliers(previous)
  }
)
