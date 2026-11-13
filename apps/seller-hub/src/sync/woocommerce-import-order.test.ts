import { expect, test } from "vitest"
import { DeferSyncError, PermanentSyncError } from "../queue/queues.js"
import { PENDING_RECHECK_MS } from "./shopify-import-order.js"
import { woocommerceImportAdapter } from "./woocommerce-import-order.js"
import type { NormalizedWooOrder } from "../woocommerce/orders.js"

const order = (over: Partial<NormalizedWooOrder> = {}): NormalizedWooOrder => ({
  wooOrderId: "7",
  status: "processing",
  currencyCode: "USD",
  buyerEmail: "a@b.co",
  items: [{ sku: "S", quantity: 1, unitPrice: 1 }],
  shippingAddress: {
    first_name: "A",
    last_name: "B",
    address_1: "1 St",
    city: "Reno",
    country_code: "US",
    postal_code: "89501",
  },
  ...over,
})

test("adapter identity", () => {
  expect(woocommerceImportAdapter.label).toBe("WooCommerce order")
  expect(woocommerceImportAdapter.metadataKey).toBe("woocommerce_order_id")
})

test("gate imports processing and completed", () => {
  for (const status of ["processing", "completed"]) {
    expect(woocommerceImportAdapter.gate(order({ status }), "7")).toBeNull()
  }
})

test("gate skips cancelled/refunded/trash", () => {
  for (const status of ["cancelled", "refunded", "trash"]) {
    expect(woocommerceImportAdapter.gate(order({ status }), "7")).toMatch(
      /not imported/
    )
  }
})

test("gate defers pending/on-hold/failed by the shared recheck window", () => {
  for (const status of ["pending", "on-hold", "failed"]) {
    const before = Date.now()
    try {
      woocommerceImportAdapter.gate(order({ status }), "7")
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(DeferSyncError)
      expect((e as DeferSyncError).retryAt).toBeGreaterThanOrEqual(
        before + PENDING_RECHECK_MS
      )
    }
  }
})

test("gate is permanent for unknown status, non-USD and blank SKU", () => {
  for (const o of [
    order({ status: "checkout-draft" }),
    order({ currencyCode: "EUR" }),
    order({ items: [{ sku: "", quantity: 1, unitPrice: 1 }] }),
  ]) {
    expect(() => woocommerceImportAdapter.gate(o, "7")).toThrow(
      PermanentSyncError
    )
  }
})

test("draftFields carry email, address and the metadata key", () => {
  expect(woocommerceImportAdapter.draftFields(order(), "7")).toEqual({
    email: "a@b.co",
    shipping_address: order().shippingAddress,
    metadata: { woocommerce_order_id: "7" },
  })
})
