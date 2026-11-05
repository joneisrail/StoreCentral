import { Module } from "@medusajs/framework/utils"
import PurchaseModuleService from "./service"

export const PURCHASE_MODULE = "purchase"

export default Module(PURCHASE_MODULE, {
  service: PurchaseModuleService,
})
