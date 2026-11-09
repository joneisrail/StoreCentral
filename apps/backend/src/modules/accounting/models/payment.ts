import { model } from "@medusajs/framework/utils"

const Payment = model.define("supplier_payment", {
  id: model.id().primaryKey(),
  display_id: model.autoincrement(),
  invoice_id: model.text(),
  supplier_id: model.text(),
  amount: model.bigNumber(),
  paid_at: model.dateTime(),
  method: model.enum(["bank_transfer", "cash", "card", "cheque", "other"]),
  reference: model.text().nullable(),
  note: model.text().nullable(),
  status: model.enum(["recorded", "void"]).default("recorded"),
  voided_at: model.dateTime().nullable(),
  currency_code: model.text().default("usd"),
})

export default Payment
