import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const CreateSupplierSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
})
export type CreateSupplierSchema = z.infer<typeof CreateSupplierSchema>

export const UpdateSupplierSchema = CreateSupplierSchema.partial()
export type UpdateSupplierSchema = z.infer<typeof UpdateSupplierSchema>

export const supplierMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/suppliers",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateSupplierSchema)],
  },
  {
    matcher: "/admin/suppliers/:id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateSupplierSchema)],
  },
]
