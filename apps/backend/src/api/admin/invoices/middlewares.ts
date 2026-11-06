import {
  MiddlewareRoute,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

// A line names the supplier's code, one of our variants, or both. Remembering
// a code needs both: the code to add and the variant it stands for.
export const InvoiceItemSchema = z
  .object({
    supplier_sku: z.string().trim().min(1).optional(),
    variant_id: z.string().min(1).optional(),
    remember_code: z.boolean().optional(),
    purchase_item_id: z.string().min(1).optional(),
    quantity: z.number().int().min(1),
    unit_cost: z.number().min(0),
    description: z.string().trim().min(1).optional(),
  })
  .refine((item) => item.supplier_sku || item.variant_id, {
    message: "Each line needs a supplier_sku or a variant_id",
  })
  .refine(
    (item) => !item.remember_code || (item.supplier_sku && item.variant_id),
    { message: "remember_code needs both supplier_sku and variant_id" }
  )
export type InvoiceItemSchema = z.infer<typeof InvoiceItemSchema>

export const CreateInvoiceSchema = z.object({
  purchase_id: z.string().min(1),
  invoice_number: z.string().trim().min(1),
  invoice_date: z.iso.date(),
  due_date: z.iso.date().optional(),
  shipping_cost: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  other_cost: z.number().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(InvoiceItemSchema).min(1),
})
export type CreateInvoiceSchema = z.infer<typeof CreateInvoiceSchema>

// Every create field but purchase_id is optional; unknown keys (purchase_id
// included) are rejected. `items`, when given, replaces every line.
export const UpdateInvoiceSchema = CreateInvoiceSchema.omit({
  purchase_id: true,
})
  .partial()
  .strict()
export type UpdateInvoiceSchema = z.infer<typeof UpdateInvoiceSchema>

export const ListInvoicesQuerySchema = z.object({
  purchase_id: z.string().optional(),
  supplier_id: z.string().optional(),
  status: z.enum(["draft", "posted", "void"]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListInvoicesQuerySchema = z.infer<typeof ListInvoicesQuerySchema>

export const invoiceMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/invoices",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ListInvoicesQuerySchema, {
        defaults: ["id"],
        isList: true,
      }),
    ],
  },
  {
    matcher: "/admin/invoices",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateInvoiceSchema)],
  },
  {
    matcher: "/admin/invoices/:id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateInvoiceSchema)],
  },
]
