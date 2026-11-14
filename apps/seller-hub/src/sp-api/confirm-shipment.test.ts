import { afterEach, expect, test, vi } from "vitest"
import type { SpApiClient } from "./client.js"
import { confirmShipment } from "./confirm-shipment.js"

const TRACKING = "9400111899223344556677"

const input = {
  amazonOrderId: "114-1234567-1234567",
  marketplaceId: "ATVPDKIKX0DER",
  carrierCode: "USPS",
  trackingNumber: TRACKING,
  shipDate: "2026-11-15T10:00:00Z",
  items: [
    { orderItemId: "item-1", quantity: 2 },
    { orderItemId: "item-2", quantity: 1 },
  ],
}

afterEach(() => vi.restoreAllMocks())

test("confirmShipment sends the documented path and body", async () => {
  const request = vi.fn().mockResolvedValue(undefined)
  await confirmShipment({ request } as unknown as SpApiClient, input)

  expect(request).toHaveBeenCalledTimes(1)
  const op = request.mock.calls[0]![0]
  expect(op.name).toBe("confirmShipment")
  expect(op.method).toBe("POST")
  expect(op.path).toBe("/orders/v0/orders/114-1234567-1234567/shipmentConfirmation")
  expect(op.body).toEqual({
    marketplaceId: "ATVPDKIKX0DER",
    packageDetail: {
      packageReferenceId: "1",
      carrierCode: "USPS",
      trackingNumber: TRACKING,
      shipDate: "2026-11-15T10:00:00Z",
      orderItems: [
        { orderItemId: "item-1", quantity: 2 },
        { orderItemId: "item-2", quantity: 1 },
      ],
    },
  })
  expect(op.rateLimit.ratePerSecond).toBeGreaterThan(0)
})

test("confirmShipment url-encodes the order id", async () => {
  const request = vi.fn().mockResolvedValue(undefined)
  await confirmShipment({ request } as unknown as SpApiClient, {
    ...input,
    amazonOrderId: "a/b?c",
  })
  expect(request.mock.calls[0]![0].path).toBe(
    "/orders/v0/orders/a%2Fb%3Fc/shipmentConfirmation"
  )
})

test("confirmShipment propagates client errors and never logs tracking data", async () => {
  const spies = (["log", "error", "warn", "info"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation(() => {})
  )
  const boom = new Error("SP-API request failed with status 400")
  const request = vi.fn().mockRejectedValue(boom)

  await expect(
    confirmShipment({ request } as unknown as SpApiClient, input)
  ).rejects.toBe(boom)

  for (const spy of spies) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TRACKING)
    expect(spy).not.toHaveBeenCalled()
  }
})
