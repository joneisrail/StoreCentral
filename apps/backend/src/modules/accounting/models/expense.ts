import { model } from "@medusajs/framework/utils"
import { EXPENSE_CATEGORIES } from "../expenses"

const Expense = model.define("expense", {
  id: model.id().primaryKey(),
  display_id: model.autoincrement(),
  expense_date: model.dateTime(),
  category: model.enum([...EXPENSE_CATEGORIES]),
  amount: model.bigNumber(),
  description: model.text(),
  payee: model.text().nullable(),
  currency_code: model.text().default("usd"),
})

export default Expense
