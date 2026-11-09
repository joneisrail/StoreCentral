import {
  MiddlewareRoute,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

export const PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
  "card",
  "cheque",
  "other",
] as const

// Blank text is treated as not given.
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)

export const RecordPaymentSchema = z.object({
  invoice_id: z.string().min(1),
  amount: z.number(),
  paid_at: z.iso.date(),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText,
  note: optionalText,
})
export type RecordPaymentSchema = z.infer<typeof RecordPaymentSchema>

export const ListPaymentsQuerySchema = z.object({
  invoice_id: z.string().optional(),
  supplier_id: z.string().optional(),
  status: z.enum(["recorded", "void"]).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListPaymentsQuerySchema = z.infer<typeof ListPaymentsQuerySchema>

export const paymentMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/supplier-payments",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ListPaymentsQuerySchema, {
        defaults: ["id"],
        isList: true,
      }),
    ],
  },
  {
    matcher: "/admin/supplier-payments",
    method: "POST",
    middlewares: [validateAndTransformBody(RecordPaymentSchema)],
  },
]
