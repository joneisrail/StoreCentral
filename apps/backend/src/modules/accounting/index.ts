import { Module } from "@medusajs/framework/utils"
import AccountingModuleService from "./service"

export const ACCOUNTING_MODULE = "accounting"

export default Module(ACCOUNTING_MODULE, {
  service: AccountingModuleService,
})
