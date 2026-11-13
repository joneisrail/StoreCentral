import { randomUUID } from "node:crypto"
import { PermanentSyncError } from "../queue/queues.js"
import type { ShopifyClient } from "./client.js"

const SET_QUANTITIES = `
  mutation SetAvailable($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      userErrors { field message }
    }
  }
`

/** Sets the absolute `available` quantity (clamped to a non-negative integer). */
export const setShopifyAvailable = async (
  client: ShopifyClient,
  input: { inventoryItemId: string; locationId: string; quantity: number; idempotencyKey?: string }
): Promise<void> => {
  const quantity = Math.max(0, Math.floor(input.quantity))
  const data = await client.graphql<{
    inventorySetQuantities: {
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(SET_QUANTITIES, {
    // Fresh key per call by default: a repeated same-quantity correction must still apply.
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
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
