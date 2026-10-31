import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { EasyPostFulfillmentService } from "./services/easypost-fulfillment"

const services = [EasyPostFulfillmentService]

export default ModuleProvider(Modules.FULFILLMENT, {
  services,
})

// Re-exported so callers outside this provider (e.g. the EasyPost tracking
// webhook route in the consuming app) can reuse this package's own tested
// HMAC webhook-signature verification instead of re-implementing it.
export { EasyPostClient } from "./core/easypost-client"
export type {
  EasyPostClientOptions,
  EasyPostShipment,
} from "./core/easypost-client"

// Re-exported so the admin bulk-fulfillment route (Task 6) can convert a
// Medusa address into EasyPost's address shape without re-implementing this
// package's own validated conversion.
export { toEasyPostAddress } from "./services/easypost-fulfillment"
