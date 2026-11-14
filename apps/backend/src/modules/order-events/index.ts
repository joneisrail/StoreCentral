import { Module } from "@medusajs/framework/utils"
import OrderEventsModuleService from "./service"

export const ORDER_EVENTS_MODULE = "orderEvents"

export type { OrderEventType, OrderEventRecord } from "./service"

export default Module(ORDER_EVENTS_MODULE, {
  service: OrderEventsModuleService,
})
