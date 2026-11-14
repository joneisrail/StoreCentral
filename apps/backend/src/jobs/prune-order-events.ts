import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_EVENTS_MODULE } from "../modules/order-events"
import type OrderEventsModuleService from "../modules/order-events/service"

const RETENTION_YEARS = 2

export default async function pruneOrderEvents(container: MedusaContainer) {
  const service: OrderEventsModuleService = container.resolve(ORDER_EVENTS_MODULE)
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS)

  const deleted = await service.pruneOlderThan(cutoff)

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(`prune-order-events: deleted ${deleted} order event(s)`)
}

export const config = {
  name: "prune-order-events",
  schedule: "0 3 * * *",
}
