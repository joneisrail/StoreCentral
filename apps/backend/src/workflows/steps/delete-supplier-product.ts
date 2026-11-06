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

// Everything needed to dismiss an entry's link and to recreate the row.
export const toSupplierProductSnapshot = (
  row: {
    id: string
    variant_id: string
    supplier_sku: string
    supplier_sku_key: string
    supplier_title: string | null
    unit_cost: unknown
    notes: string | null
  },
  supplierId: string
): SupplierProductSnapshot => ({
  id: row.id,
  supplier_id: supplierId,
  variant_id: row.variant_id,
  supplier_sku: row.supplier_sku,
  supplier_sku_key: row.supplier_sku_key,
  supplier_title: row.supplier_title,
  unit_cost:
    row.unit_cost === null || row.unit_cost === undefined
      ? null
      : Number(row.unit_cost),
  notes: row.notes,
})

// Read-only: 404 when the entry is missing or belongs to another supplier.
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

    return new StepResponse(
      toSupplierProductSnapshot(existing, input.supplier_id)
    )
  }
)

// Deletes the entries; compensation recreates them with the same ids. Their
// links are restored by dismissRemoteLinkStep's own compensation.
export const deleteSupplierProductsStep = createStep(
  "delete-supplier-products",
  async (snapshots: SupplierProductSnapshot[], { container }) => {
    if (!snapshots.length) {
      return new StepResponse({ ids: [] as string[] }, [])
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)

    const ids = snapshots.map((s) => s.id)
    await supplierModule.deleteSupplierProducts(ids)

    return new StepResponse({ ids }, snapshots)
  },
  async (snapshots, { container }) => {
    if (!snapshots?.length) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.createSupplierProducts(snapshots)
  }
)
