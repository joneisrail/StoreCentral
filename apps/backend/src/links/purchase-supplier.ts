import { defineLink } from "@medusajs/framework/utils"
import PurchaseModule from "../modules/purchase"
import SupplierModule from "../modules/supplier"

export default defineLink(
  { linkable: PurchaseModule.linkable.purchase, isList: true },
  SupplierModule.linkable.supplier
)
