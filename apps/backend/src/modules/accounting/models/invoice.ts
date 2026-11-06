import { model } from "@medusajs/framework/utils"
import InvoiceItem from "./invoice-item"

const Invoice = model
  .define("invoice", {
    id: model.id().primaryKey(),
    display_id: model.autoincrement(),
    supplier_id: model.text(),
    purchase_id: model.text(),
    invoice_number: model.text(),
    invoice_number_key: model.text(),
    status: model.enum(["draft", "posted", "void"]).default("draft"),
    invoice_date: model.dateTime(),
    due_date: model.dateTime().nullable(),
    currency_code: model.text().default("usd"),
    shipping_cost: model.bigNumber().default(0),
    tax: model.bigNumber().default(0),
    other_cost: model.bigNumber().default(0),
    notes: model.text().nullable(),
    posted_at: model.dateTime().nullable(),
    voided_at: model.dateTime().nullable(),
    items: model.hasMany(() => InvoiceItem, { mappedBy: "invoice" }),
  })
  .indexes([
    {
      // Void invoices free their number; soft-deleted rows are excluded by Medusa.
      on: ["supplier_id", "invoice_number_key"],
      unique: true,
      where: { status: { $ne: "void" } },
    },
  ])

export default Invoice
