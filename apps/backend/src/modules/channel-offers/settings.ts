import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const SHARE_STOCK_METADATA_KEY = "share_stock_after_sale"

// Store-wide switch kept in store.metadata (same place as the order page's
// high_value_threshold). Anything other than boolean true reads as false.
export async function readShareStockSetting(
  container: Pick<MedusaContainer, "resolve">
): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "store",
    fields: ["id", "metadata"],
  })
  return (data[0] as any)?.metadata?.[SHARE_STOCK_METADATA_KEY] === true
}
