import { createHash, timingSafeEqual } from "node:crypto"

const digest = (value: string): Buffer => createHash("sha256").update(value).digest()

/** Constant-time bearer check; compares fixed-length digests so length never leaks. */
export const isAuthorized = (header: string | undefined, secret: string): boolean => {
  if (!secret || !header) return false
  const match = /^Bearer (.+)$/.exec(header)
  if (!match) return false
  return timingSafeEqual(digest(match[1]!), digest(secret))
}
