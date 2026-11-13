import { expect, test } from "vitest"
import { isAuthorized } from "./auth.js"

const SECRET = "s3cret-token-value"

test("rejects a missing header", () => {
  expect(isAuthorized(undefined, SECRET)).toBe(false)
  expect(isAuthorized("", SECRET)).toBe(false)
})
test("rejects a wrong token", () => {
  expect(isAuthorized("Bearer wrong", SECRET)).toBe(false)
})
test("rejects a wrong scheme", () => {
  expect(isAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false)
  expect(isAuthorized(SECRET, SECRET)).toBe(false)
})
test("rejects everything when the configured secret is empty", () => {
  expect(isAuthorized("Bearer ", "")).toBe(false)
  expect(isAuthorized("Bearer x", "")).toBe(false)
})
test("accepts the correct token", () => {
  expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
})
test("rejects tokens of different length without throwing", () => {
  expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false)
  expect(isAuthorized("Bearer s", SECRET)).toBe(false)
})
