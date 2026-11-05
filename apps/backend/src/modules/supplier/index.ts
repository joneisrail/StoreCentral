import { Module } from "@medusajs/framework/utils"
import SupplierModuleService from "./service"

export const SUPPLIER_MODULE = "supplier"

export default Module(SUPPLIER_MODULE, {
  service: SupplierModuleService,
})
