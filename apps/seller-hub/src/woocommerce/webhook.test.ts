import crypto from "node:crypto"
import { expect, test } from "vitest"
import { verifyWooSignature } from "./webhook.js"

const sign = (body: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(body).digest("base64")

test("accepts a valid signature (string and Buffer)", () => {
  const body = '{"id":1}'
  const sig = sign(body, "s3cret")
  expect(verifyWooSignature(body, sig, "s3cret")).toBe(true)
  expect(verifyWooSignature(Buffer.from(body), sig, "s3cret")).toBe(true)
})

test("rejects an altered body", () => {
  const sig = sign('{"id":1}', "s3cret")
  expect(verifyWooSignature('{"id":2}', sig, "s3cret")).toBe(false)
})

test("rejects a wrong secret", () => {
  expect(verifyWooSignature("x", sign("x", "other"), "s3cret")).toBe(false)
})

test("rejects a missing header", () => {
  expect(verifyWooSignature("x", undefined, "s3cret")).toBe(false)
  expect(verifyWooSignature("x", "", "s3cret")).toBe(false)
})

test("rejects a header of the wrong length without throwing", () => {
  expect(verifyWooSignature("x", "abc", "s3cret")).toBe(false)
  expect(verifyWooSignature("x", sign("x", "s3cret") + "AAAA", "s3cret")).toBe(false)
})
