import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import {
  invoiceLockKey,
  invoiceStatusLockKey,
  normalizeInvoiceNumber,
} from "../../modules/accounting/utils"
import { guardInvoiceNumber } from "./create-invoice"
import type { ResolvedInvoiceLine } from "./resolve-invoice-lines"

const assertDraft = (invoice: { invoice_number: string; status: string }) => {
  if (invoice.status !== "draft") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Invoice ${invoice.invoice_number} is ${invoice.status} and locked; only a draft invoice can be edited`
    )
  }
}

export type LoadDraftInvoiceStepInput = { id: string }

export type LoadedDraftInvoice = {
  id: string
  purchase_id: string
  supplier: { id: string; name: string }
}

// Read-only: 404 for an unknown invoice and 400 unless it is a draft, so the
// workflow fails before it remembers any code. The update step checks the
// status again under the invoice's lock.
export const loadDraftInvoiceStep = createStep(
  "load-draft-invoice",
  async (input: LoadDraftInvoiceStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const [invoice] = await accounting.listInvoices(
      { id: input.id },
      {
        select: [
          "id",
          "status",
          "supplier_id",
          "purchase_id",
          "invoice_number",
        ],
        take: 1,
      }
    )
    if (!invoice) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Invoice with id: ${input.id} was not found`
      )
    }
    assertDraft(invoice)

    const { data: suppliers } = await query.graph({
      entity: "supplier",
      fields: ["id", "name"],
      filters: { id: invoice.supplier_id },
    })
    const supplier = suppliers[0] as { id: string; name: string } | undefined

    const result: LoadedDraftInvoice = {
      id: invoice.id,
      purchase_id: invoice.purchase_id,
      supplier: {
        id: invoice.supplier_id,
        name: supplier?.name ?? invoice.supplier_id,
      },
    }
    return new StepResponse(result)
  }
)

export type UpdateInvoiceStepInput = {
  id: string
  supplier: { id: string; name: string }
  invoice_number?: string
  invoice_date?: string
  due_date?: string
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
  // When given, replaces every existing line.
  items?: ResolvedInvoiceLine[]
}

type ItemSnapshot = {
  id: string
  invoice_id: string
  purchase_item_id: string | null
  variant_id: string
  supplier_sku: string
  description: string
  quantity: number
  unit_cost: number
}

type PreviousState = {
  id: string
  header: {
    invoice_number: string
    invoice_number_key: string
    invoice_date: string
    due_date: string | null
    shipping_cost: number
    tax: number
    other_cost: number
    notes: string | null
  }
  // The lines that were replaced, or null when the lines were not touched.
  replaced_items: ItemSnapshot[] | null
  created_item_ids: string[]
}

export type UpdateInvoiceStepOutput = {
  id: string
  // The new lines, or null when the lines were not touched.
  items: { id: string; variant_id: string }[] | null
  replaced_items: { id: string; variant_id: string }[]
}

const toDate = (value: unknown): string =>
  new Date(value as string | Date).toISOString()

// Puts the header back and, when the lines were replaced, removes the new
// lines and recreates any missing old line under its original id (so the
// restored item-variant links match). Safe to run more than once.
const restore = async (
  accounting: AccountingModuleService,
  previous: PreviousState
) => {
  const { header } = previous
  await accounting.updateInvoices({
    id: previous.id,
    ...header,
    invoice_date: new Date(header.invoice_date),
    due_date: header.due_date ? new Date(header.due_date) : null,
  })

  if (!previous.replaced_items) {
    return
  }
  if (previous.created_item_ids.length) {
    await accounting.deleteInvoiceItems(previous.created_item_ids)
  }
  const remaining = await accounting.listInvoiceItems(
    { invoice_id: previous.id },
    { select: ["id"] }
  )
  const present = new Set(remaining.map((item) => item.id))
  const missing = previous.replaced_items.filter(
    (item) => !present.has(item.id)
  )
  if (missing.length) {
    await accounting.createInvoiceItems(missing)
  }
}

// Updates a draft invoice's header and, when items are given, replaces all of
// its lines. The draft check and every write run under the invoice's status
// lock (and the supplier number lock when the number is given); a failure
// part-way restores the snapshot before rethrowing.
export const updateInvoiceStep = createStep(
  "update-invoice",
  async (input: UpdateInvoiceStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    const number =
      input.invoice_number !== undefined
        ? normalizeInvoiceNumber(input.invoice_number)
        : null
    const keys = [invoiceStatusLockKey(input.id)]
    if (number) {
      keys.push(invoiceLockKey(input.supplier.id, number.invoice_number_key))
    }

    const { output, previous } = await locking.execute(keys, async () => {
      // A bad id throws NOT_FOUND (404) here.
      const existing = await accounting.retrieveInvoice(input.id, {
        relations: ["items"],
      })
      assertDraft(existing)

      const previous: PreviousState = {
        id: existing.id,
        header: {
          invoice_number: existing.invoice_number,
          invoice_number_key: existing.invoice_number_key,
          invoice_date: toDate(existing.invoice_date),
          due_date: existing.due_date ? toDate(existing.due_date) : null,
          shipping_cost: Number(existing.shipping_cost),
          tax: Number(existing.tax),
          other_cost: Number(existing.other_cost),
          notes: existing.notes,
        },
        replaced_items: input.items
          ? existing.items.map((item) => ({
              id: item.id,
              invoice_id: existing.id,
              purchase_item_id: item.purchase_item_id,
              variant_id: item.variant_id,
              supplier_sku: item.supplier_sku,
              description: item.description,
              quantity: item.quantity,
              unit_cost: Number(item.unit_cost),
            }))
          : null,
        created_item_ids: [],
      }

      const changes: Record<string, unknown> = { id: existing.id }
      if (number) {
        Object.assign(changes, number)
      }
      if (input.invoice_date !== undefined) {
        changes.invoice_date = new Date(input.invoice_date)
      }
      if (input.due_date !== undefined) {
        changes.due_date = new Date(input.due_date)
      }
      for (const key of [
        "shipping_cost",
        "tax",
        "other_cost",
        "notes",
      ] as const) {
        if (input[key] !== undefined) {
          changes[key] = input[key]
        }
      }

      let items: UpdateInvoiceStepOutput["items"] = null
      let wrote = false
      const write = async () => {
        wrote = true
        if (input.items) {
          const created = await accounting.createInvoiceItems(
            input.items.map((item) => ({
              invoice_id: existing.id,
              purchase_item_id: item.purchase_item_id,
              variant_id: item.variant_id,
              supplier_sku: item.supplier_sku,
              description: item.description,
              quantity: item.quantity,
              unit_cost: item.unit_cost,
            }))
          )
          previous.created_item_ids = created.map((item) => item.id)
          items = created.map((item) => ({
            id: item.id,
            variant_id: item.variant_id,
          }))
        }

        await accounting.updateInvoices(changes as never)

        if (input.items && existing.items.length) {
          await accounting.deleteInvoiceItems(
            existing.items.map((item) => item.id)
          )
        }
      }

      try {
        if (number) {
          await guardInvoiceNumber(
            accounting,
            { supplier: input.supplier, number, exclude_id: existing.id },
            write
          )
        } else {
          await write()
        }
      } catch (err) {
        // Compensation only runs for completed steps, so undo a partial write.
        if (wrote) {
          await restore(accounting, previous)
        }
        throw err
      }

      const output: UpdateInvoiceStepOutput = {
        id: existing.id,
        items,
        replaced_items: existing.items.map((item) => ({
          id: item.id,
          variant_id: item.variant_id,
        })),
      }
      return { output, previous }
    })

    return new StepResponse(output, previous)
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const locking = container.resolve(Modules.LOCKING)
    await locking.execute([invoiceStatusLockKey(previous.id)], () =>
      restore(accounting, previous)
    )
  }
)
