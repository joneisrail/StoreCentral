import {
  MiddlewareRoute,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const CreateSupplierSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  contact_name: z.string().optional(),
  website: z.string().optional(),
  tax_id: z.string().optional(),
  payment_terms: z.string().optional(),
  lead_time_days: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
})
export type CreateSupplierSchema = z.infer<typeof CreateSupplierSchema>

// Every optional field also accepts null to clear it; name stays non-null.
export const UpdateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  lead_time_days: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
})
export type UpdateSupplierSchema = z.infer<typeof UpdateSupplierSchema>

export const ListSuppliersQuerySchema = z.object({
  q: z.string().optional(),
  is_active: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListSuppliersQuerySchema = z.infer<typeof ListSuppliersQuerySchema>

export const supplierMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/suppliers",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ListSuppliersQuerySchema, {
        defaults: ["id"],
        isList: true,
      }),
    ],
  },
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
