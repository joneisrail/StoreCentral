import { expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import { ShopifyClient } from "./client.js"
import { setShopifyAvailable } from "./inventory.js"

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ data }),
})
const clientFor = (f: unknown) =>
  new ShopifyClient({
    shopDomain: "s.myshopify.com",
    accessToken: "t",
    fetchImpl: f as typeof fetch,
    sleep: async () => {},
  })

test("clamps -3 to 0 and sends the mapped location", async () => {
  const f = vi
    .fn()
    .mockResolvedValue(ok({ inventorySetQuantities: { userErrors: [] } }))
  await setShopifyAvailable(clientFor(f), {
    inventoryItemId: "gid://shopify/InventoryItem/1",
    locationId: "gid://shopify/Location/5",
    quantity: -3,
  })
  const { input } = JSON.parse(f.mock.calls[0][1].body).variables
  expect(input).toMatchObject({
    name: "available",
    reason: "correction",
    ignoreCompareQuantity: true,
  })
  expect(input.quantities).toEqual([
    {
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/5",
      quantity: 0,
    },
  ])
})

test("floors fractional quantities", async () => {
  const f = vi
    .fn()
    .mockResolvedValue(ok({ inventorySetQuantities: { userErrors: [] } }))
  await setShopifyAvailable(clientFor(f), {
    inventoryItemId: "i",
    locationId: "l",
    quantity: 4.7,
  })
  expect(
    JSON.parse(f.mock.calls[0][1].body).variables.input.quantities[0].quantity
  ).toBe(4)
})

test("userErrors become PermanentSyncError", async () => {
  const f = vi.fn().mockResolvedValue(
    ok({
      inventorySetQuantities: { userErrors: [{ field: [], message: "bad" }] },
    })
  )
  await expect(
    setShopifyAvailable(clientFor(f), {
      inventoryItemId: "i",
      locationId: "l",
      quantity: 1,
    })
  ).rejects.toBeInstanceOf(PermanentSyncError)
})
