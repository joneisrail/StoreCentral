import { Module } from "@medusajs/framework/utils"
import ChannelOffersModuleService from "./service"

export const CHANNEL_OFFERS_MODULE = "channelOffers"

export { MOVEMENT_KINDS } from "./service"
export type {
  ChannelOfferRecord,
  MovementKind,
  SyncState,
} from "./service"

export default Module(CHANNEL_OFFERS_MODULE, {
  service: ChannelOffersModuleService,
})
