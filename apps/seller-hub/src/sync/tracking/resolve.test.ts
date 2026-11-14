import { expect, test } from "vitest"
import { resolveTrackingTarget } from "./resolve.js"

test("picks the marketplace, account and external id", () => {
  expect(
    resolveTrackingTarget({ shopify_account_id: "a1", shopify_order_id: "gid://shopify/Order/1" })
  ).toEqual({ marketplace: "shopify", accountId: "a1", externalOrderId: "gid://shopify/Order/1" })
  expect(
    resolveTrackingTarget({ woocommerce_account_id: "a2", woocommerce_order_id: "77" })
  ).toEqual({ marketplace: "woocommerce", accountId: "a2", externalOrderId: "77" })
})

test("amazon orders resolve to amazon (nothing is enqueued for it: no runtime)", () => {
  expect(
    resolveTrackingTarget({ amazon_account_id: "a3", amazon_order_id: "111-222" })
  ).toEqual({ marketplace: "amazon", accountId: "a3", externalOrderId: "111-222" })
})

test("returns null for orders without account metadata", () => {
  expect(resolveTrackingTarget({})).toBeNull()
  expect(resolveTrackingTarget(null)).toBeNull()
  expect(resolveTrackingTarget({ shopify_order_id: "gid://shopify/Order/1" })).toBeNull()
  expect(resolveTrackingTarget({ shopify_account_id: "a1" })).toBeNull()
  expect(resolveTrackingTarget({ shopify_account_id: "", shopify_order_id: "x" })).toBeNull()
})
