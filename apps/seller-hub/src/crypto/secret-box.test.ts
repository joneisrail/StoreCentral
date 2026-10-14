import { expect, test } from "vitest"
import { decrypt, encrypt } from "./secret-box.js"

test("decrypt(encrypt(x)) === x", () => {
  const key = "00".repeat(32) // 32-byte hex key
  const plaintext = "Atza|IwEBIxxxxx-refresh-token"
  const ciphertext = encrypt(plaintext, key)
  expect(ciphertext).not.toBe(plaintext)
  expect(decrypt(ciphertext, key)).toBe(plaintext)
})

test("decrypt throws on tampered ciphertext", () => {
  const key = "00".repeat(32)
  const ciphertext = encrypt("secret", key)
  const tampered = ciphertext.slice(0, -2) + "00"
  expect(() => decrypt(tampered, key)).toThrow()
})

test("encrypt uses a random IV per call, so repeated calls produce different ciphertext", () => {
  const key = "00".repeat(32)
  const a = encrypt("same-plaintext", key)
  const b = encrypt("same-plaintext", key)
  expect(a).not.toBe(b)
})
