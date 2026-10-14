import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH_BYTES = 12

/**
 * Encrypts `plaintext` with AES-256-GCM using `keyHex` (a 32-byte/64-hex-char
 * key). A fresh random 12-byte IV is generated on every call, so encrypting
 * the same plaintext twice produces different ciphertext.
 *
 * Output format: base64(iv):base64(authTag):base64(ciphertext)
 */
export const encrypt = (plaintext: string, keyHex: string): string => {
  const key = Buffer.from(keyHex, "hex")
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [iv, authTag, ciphertext]
    .map((buf) => buf.toString("base64"))
    .join(":")
}

/**
 * Decrypts a string produced by `encrypt`. Throws if the ciphertext is
 * malformed or has been tampered with (the GCM auth tag fails to verify) —
 * it never silently returns garbage.
 */
export const decrypt = (ciphertext: string, keyHex: string): string => {
  const parts = ciphertext.split(":")
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format")
  }
  const [ivB64, authTagB64, dataB64] = parts as [string, string, string]

  const key = Buffer.from(keyHex, "hex")
  const iv = Buffer.from(ivB64, "base64")
  const authTag = Buffer.from(authTagB64, "base64")
  const data = Buffer.from(dataB64, "base64")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
  return plaintext.toString("utf8")
}
