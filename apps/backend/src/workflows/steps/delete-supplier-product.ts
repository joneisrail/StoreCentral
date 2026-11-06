import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"
import { retrieveSupplierProductForSupplier } from "./supplier-product-helpers"

export type DeleteSupplierProductStepInput = {
  id: string
  supplier_id: string
}

export type SupplierProductSnapshot = {
  id: string
  supplier_id: string
  variant_id: string
  supplier_sku: string
  supplier_sku_key: string
  supplier_title: string | null
  unit_cost: number | null
  notes: string | null
}

// Read-only: 404 when the entry is missing or belongs to another supplier.
// Returns a snapshot used to dismiss the link and to restore the row.
export const retrieveSupplierProductStep = createStep(
  "retrieve-supplier-product",
  async (input: DeleteSupplierProductStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)

    const existing = await retrieveSupplierProductForSupplier(
      supplierModule,
      input.supplier_id,
      input.id
    )

    const snapshot: SupplierProductSnapshot = {
      id: existing.id,
      supplier_id: input.supplier_id,
      variant_id: existing.variant_id,
      supplier_sku: existing.supplier_sku,
      supplier_sku_key: existing.supplier_sku_key,
      supplier_title: existing.supplier_title,
      unit_cost:
        existing.unit_cost === null ? null : Number(existing.unit_cost),
      notes: existing.notes,
    }
    return new StepResponse(snapshot)
  }
)

// The link is restored by dismissRemoteLinkStep's own compensation.
export const deleteSupplierProductStep = createStep(
  "delete-supplier-product",
  async (snapshot: SupplierProductSnapshot, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)

    await supplierModule.deleteSupplierProducts(snapshot.id)

    return new StepResponse({ id: snapshot.id }, snapshot)
  },
  async (snapshot, { container }) => {
    if (!snapshot) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.createSupplierProducts(snapshot)
  }
)
