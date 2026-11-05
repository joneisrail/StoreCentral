import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { deleteSupplierWorkflow } from "../../../../workflows/delete-supplier"
import { updateSupplierWorkflow } from "../../../../workflows/update-supplier"
import type { UpdateSupplierSchema } from "../middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "supplier",
    fields: ["id", "name", "email", "phone", "address", "notes", "created_at"],
    filters: { id: req.params.id },
  })

  if (!data.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Supplier with id: ${req.params.id} was not found`
    )
  }

  res.json({ supplier: data[0] })
}

export async function POST(
  req: MedusaRequest<UpdateSupplierSchema>,
  res: MedusaResponse
) {
  const { result } = await updateSupplierWorkflow(req.scope).run({
    input: { ...req.validatedBody, id: req.params.id },
  })

  res.json({ supplier: result.supplier })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { result } = await deleteSupplierWorkflow(req.scope).run({
    input: { id: req.params.id },
  })

  res.json({ id: result.id, object: "supplier", deleted: true })
}
