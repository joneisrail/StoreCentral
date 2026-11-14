import { expect, test } from "vitest"
import { coversWholeOrder } from "./coverage.js"

const items = [
  { id: "a", quantity: 2 },
  { id: "b", quantity: 1 },
]

test("covers the whole order when every line is fully shipped", () => {
  expect(
    coversWholeOrder(items, [
      { lineItemId: "a", quantity: 2 },
      { lineItemId: "b", quantity: 1 },
    ])
  ).toBe(true)
})

test("sums split quantities for the same line", () => {
  expect(
    coversWholeOrder(items, [
      { lineItemId: "a", quantity: 1 },
      { lineItemId: "a", quantity: 1 },
      { lineItemId: "b", quantity: 1 },
    ])
  ).toBe(true)
})

test("a missing line or short quantity is a partial shipment", () => {
  expect(coversWholeOrder(items, [{ lineItemId: "a", quantity: 2 }])).toBe(false)
  expect(
    coversWholeOrder(items, [
      { lineItemId: "a", quantity: 1 },
      { lineItemId: "b", quantity: 1 },
    ])
  ).toBe(false)
})

test("an order with no items is never whole", () => {
  expect(coversWholeOrder([], [])).toBe(false)
})
