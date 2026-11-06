import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteSupplierProductWorkflow } from "../../../../../../workflows/delete-supplier-product"
import { updateSupplierProductWorkflow } from "../../../../../../workflows/update-supplier-product"
import { retrieveAdminSupplierProduct } from "../../../map-supplier-product"
import type { UpdateSupplierProductSchema } from "../../../middlewares"

export async function POST(
  req: MedusaRequest<UpdateSupplierProductSchema>,
  res: MedusaResponse
) {
  const { result } = await updateSupplierProductWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      id: req.params.product_id,
      supplier_id: req.params.id,
    },
  })

  res.json({
    supplier_product: await retrieveAdminSupplierProduct(
      req.scope,
      result.supplier_product.id
    ),
  })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { result } = await deleteSupplierProductWorkflow(req.scope).run({
    input: { id: req.params.product_id, supplier_id: req.params.id },
  })

  res.json({ id: result.id, object: "supplier_product", deleted: true })
}
