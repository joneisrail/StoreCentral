import {
  MiddlewareRoute,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { EXPENSE_CATEGORIES } from "../../../modules/accounting/expenses"

const description = z.string().trim().min(1).max(200)
// Blank text means no payee.
const payee = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((value) => value || null)

export const CreateExpenseSchema = z.object({
  expense_date: z.iso.date(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number(),
  description,
  payee: payee.optional(),
})
export type CreateExpenseSchema = z.infer<typeof CreateExpenseSchema>

export const UpdateExpenseSchema = z
  .object({
    expense_date: z.iso.date().optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    amount: z.number().optional(),
    description: description.optional(),
    payee: payee.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  })
export type UpdateExpenseSchema = z.infer<typeof UpdateExpenseSchema>

export const ListExpensesQuerySchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must not be after to",
  })
export type ListExpensesQuerySchema = z.infer<typeof ListExpensesQuerySchema>

export const expenseMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/expenses",
    method: "GET",
    middlewares: [
      validateAndTransformQuery(ListExpensesQuerySchema, {
        defaults: ["id"],
        isList: true,
      }),
    ],
  },
  {
    matcher: "/admin/expenses",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateExpenseSchema)],
  },
  {
    matcher: "/admin/expenses/:id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateExpenseSchema)],
  },
]
