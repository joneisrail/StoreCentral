import { Module } from "@medusajs/framework/utils"
import SearchInsightsModuleService from "./service"

export const SEARCH_INSIGHTS_MODULE = "searchInsights"

export default Module(SEARCH_INSIGHTS_MODULE, {
  service: SearchInsightsModuleService,
})
