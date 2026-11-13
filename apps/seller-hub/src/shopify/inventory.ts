import { PermanentSyncError } from "../queue/queues.js"
import type { ShopifyClient } from "./client.js"

const SET_QUANTITIES = `
  mutation SetAvailable($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`

/** Sets the absolute `available` quantity (clamped to a non-negative integer). */
export const setShopifyAvailable = async (
  client: ShopifyClient,
  input: { inventoryItemId: string; locationId: string; quantity: number }
): Promise<void> => {
  const quantity = Math.max(0, Math.floor(input.quantity))
  const data = await client.graphql<{
    inventorySetQuantities: {
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(SET_QUANTITIES, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId: input.inventoryItemId,
          locationId: input.locationId,
          quantity,
        },
      ],
    },
  })

  const errors = data.inventorySetQuantities.userErrors
  if (errors.length > 0) {
    throw new PermanentSyncError(
      `Shopify inventory update rejected: ${errors.map((e) => e.message).join("; ")}`
    )
  }
}
