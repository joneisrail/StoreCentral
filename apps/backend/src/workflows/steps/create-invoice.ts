import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import {
  invoiceLockKey,
  normalizeInvoiceNumber,
} from "../../modules/accounting/utils"
import type { ResolvedInvoiceLine } from "./resolve-invoice-lines"

export type CreateInvoiceStepInput = {
  supplier: { id: string; name: string }
  purchase_id: string
  invoice_number: string
  invoice_date: string
  due_date?: string
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
  items: ResolvedInvoiceLine[]
}

export const duplicateInvoiceNumber = (
  supplierName: string,
  invoiceNumber: string
) =>
  `Invoice number "${invoiceNumber}" already exists for supplier ${supplierName}`

// Finds a Postgres unique violation (23505) on the error or its cause chain.
const isUniqueViolation = (err: unknown): boolean => {
  let current = err as { code?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === "23505") {
      return true
    }
    current = current.cause as typeof current
  }
  return false
}

// Another invoice that is not void already holds the supplier's number.
const hasLiveInvoice = async (
  service: AccountingModuleService,
  supplierId: string,
  invoiceNumberKey: string
): Promise<boolean> => {
  const [existing] = await service.listInvoices(
    {
      supplier_id: supplierId,
      invoice_number_key: invoiceNumberKey,
      status: { $ne: "void" },
    },
    { select: ["id"], take: 1 }
  )
  return !!existing
}

// Creates a draft invoice with its items. The duplicate check and the insert
// run under one lock per supplier number; the partial unique index backs it
// up, and a violation of that index (raw 23505, or Medusa's INVALID_DATA
// mapping of it) is reported with the same message after re-checking.
export const createInvoiceStep = createStep(
  "create-invoice",
  async (input: CreateInvoiceStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    const number = normalizeInvoiceNumber(input.invoice_number)
    const duplicate = () =>
      new MedusaError(
        MedusaError.Types.INVALID_DATA,
        duplicateInvoiceNumber(input.supplier.name, number.invoice_number)
      )

    const invoice = await locking.execute(
      [invoiceLockKey(input.supplier.id, number.invoice_number_key)],
      async () => {
        if (
          await hasLiveInvoice(
            accounting,
            input.supplier.id,
            number.invoice_number_key
          )
        ) {
          throw duplicate()
        }

        try {
          return await accounting.createInvoices({
            supplier_id: input.supplier.id,
            purchase_id: input.purchase_id,
            ...number,
            invoice_date: new Date(input.invoice_date),
            due_date: input.due_date ? new Date(input.due_date) : null,
            shipping_cost: input.shipping_cost ?? 0,
            tax: input.tax ?? 0,
            other_cost: input.other_cost ?? 0,
            notes: input.notes ?? null,
            // Nested create of plain objects keeps the write atomic; the
            // generated DTO types the relation as ids.
            items: input.items.map((item) => ({
              purchase_item_id: item.purchase_item_id,
              variant_id: item.variant_id,
              supplier_sku: item.supplier_sku,
              description: item.description,
              quantity: item.quantity,
              unit_cost: item.unit_cost,
            })) as never,
          })
        } catch (err) {
          const mapped =
            err instanceof MedusaError &&
            err.type === MedusaError.Types.INVALID_DATA
          if (
            (isUniqueViolation(err) || mapped) &&
            (await hasLiveInvoice(
              accounting,
              input.supplier.id,
              number.invoice_number_key
            ))
          ) {
            throw duplicate()
          }
          throw err
        }
      }
    )

    const items = await accounting.listInvoiceItems(
      { invoice_id: invoice.id },
      { select: ["id", "variant_id"] }
    )

    return new StepResponse(
      { id: invoice.id, items },
      { id: invoice.id, item_ids: items.map((item) => item.id) }
    )
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    await accounting.deleteInvoiceItems(previous.item_ids)
    await accounting.deleteInvoices(previous.id)
  }
)
