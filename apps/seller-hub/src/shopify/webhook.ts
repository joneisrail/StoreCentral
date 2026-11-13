import crypto from "node:crypto"

/**
 * Verifies Shopify's `X-Shopify-Hmac-Sha256` header: the base64 HMAC-SHA256 of
 * the exact raw request bytes, keyed by the app's webhook secret. Compared in
 * constant time; a missing, empty or wrong-length header yields false (the
 * length guard matters because `timingSafeEqual` throws on unequal lengths).
 */
export const verifyShopifyHmac = (
  rawBody: string | Buffer,
  headerValue: string | undefined,
  secret: string
): boolean => {
  if (!headerValue) return false
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(rawBody).digest("base64")
  )
  const received = Buffer.from(headerValue)
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(received, expected)
}
