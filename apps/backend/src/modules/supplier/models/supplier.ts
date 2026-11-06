import { model } from "@medusajs/framework/utils"
import SupplierProduct from "./supplier-product"

const Supplier = model.define("supplier", {
  id: model.id().primaryKey(),
  name: model.text(),
  email: model.text().nullable(),
  phone: model.text().nullable(),
  address: model.text().nullable(),
  notes: model.text().nullable(),
  contact_name: model.text().nullable(),
  website: model.text().nullable(),
  tax_id: model.text().nullable(),
  payment_terms: model.text().nullable(),
  lead_time_days: model.number().nullable(),
  is_active: model.boolean().default(true),
  products: model.hasMany(() => SupplierProduct, { mappedBy: "supplier" }),
})

export default Supplier
