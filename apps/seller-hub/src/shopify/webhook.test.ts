import crypto from "node:crypto"
import { expect, test } from "vitest"
import { verifyShopifyHmac } from "./webhook.js"

const sign = (body: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(body).digest("base64")

test("accepts a valid signature (string and Buffer)", () => {
  const body = '{"id":1}'
  const sig = sign(body, "s3cret")
  expect(verifyShopifyHmac(body, sig, "s3cret")).toBe(true)
  expect(verifyShopifyHmac(Buffer.from(body), sig, "s3cret")).toBe(true)
})

test("rejects an altered body", () => {
  const sig = sign('{"id":1}', "s3cret")
  expect(verifyShopifyHmac('{"id":2}', sig, "s3cret")).toBe(false)
})

test("rejects a wrong secret", () => {
  const sig = sign("x", "other")
  expect(verifyShopifyHmac("x", sig, "s3cret")).toBe(false)
})

test("rejects a missing header", () => {
  expect(verifyShopifyHmac("x", undefined, "s3cret")).toBe(false)
  expect(verifyShopifyHmac("x", "", "s3cret")).toBe(false)
})

test("rejects a header of the wrong length without throwing", () => {
  expect(verifyShopifyHmac("x", "abc", "s3cret")).toBe(false)
  expect(verifyShopifyHmac("x", sign("x", "s3cret") + "AAAA", "s3cret")).toBe(false)
})
