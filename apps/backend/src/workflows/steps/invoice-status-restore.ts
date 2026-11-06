import type AccountingModuleService from "../../modules/accounting/service"

export type InvoiceStatusSnapshot = {
  id: string
  status: string
  posted_at: Date | null
  voided_at: Date | null
}

export const snapshotInvoiceStatus = (invoice: {
  id: string
  status: string
  posted_at?: Date | string | null
  voided_at?: Date | string | null
}): InvoiceStatusSnapshot => ({
  id: invoice.id,
  status: invoice.status,
  posted_at: invoice.posted_at ? new Date(invoice.posted_at) : null,
  voided_at: invoice.voided_at ? new Date(invoice.voided_at) : null,
})

export const restoreInvoiceStatus = async (
  accounting: AccountingModuleService,
  previous: InvoiceStatusSnapshot
) => {
  await accounting.updateInvoices({
    id: previous.id,
    status: previous.status,
    posted_at: previous.posted_at,
    voided_at: previous.voided_at,
  } as never)
}
