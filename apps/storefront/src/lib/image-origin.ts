// RemotePattern has no public export from next, hence the dist path.
import type { RemotePattern } from "next/dist/shared/lib/image-config"

type Env = Record<string, string | undefined>

const parseHttpOrigin = (value: string | undefined): URL | null => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  try {
    const url = new URL(trimmed)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

export const resolveImageOrigin = (
  env: Env = process.env
): string | null => {
  const url =
    parseHttpOrigin(env.NEXT_PUBLIC_IMAGE_ORIGIN) ??
    parseHttpOrigin(env.NEXT_PUBLIC_MEDUSA_BACKEND_URL)
  return url ? url.origin : null
}

// Any-port localhost is for development only: Next has no private-address
// block, so in production a localhost host is allowed only as the configured
// origin, pinned to its port.
const DEV_LOCALHOST: RemotePattern = { protocol: "http", hostname: "localhost" }
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

const STATIC_PATTERNS: RemotePattern[] = [
  { protocol: "https", hostname: "*.s3.*.amazonaws.com" },
  { protocol: "https", hostname: "*.s3.amazonaws.com" },
]

export const buildRemotePatterns = (
  env: Env = process.env
): RemotePattern[] => {
  const patterns: RemotePattern[] = []
  const production = env.NODE_ENV === "production"
  const origin = resolveImageOrigin(env)
  if (origin) {
    const url = new URL(origin)
    // A local origin on the default port is pinned with port "" in
    // production; a missing port would match every port.
    const pinPort = url.port !== "" || (production && LOCAL_HOSTS.includes(url.hostname))
    patterns.push({
      protocol: url.protocol === "https:" ? "https" : "http",
      hostname: url.hostname,
      ...(pinPort ? { port: url.port } : {}),
    })
  }
  if (!production) {
    patterns.push(DEV_LOCALHOST)
  }
  patterns.push(...STATIC_PATTERNS)

  const seen = new Set<string>()
  return patterns.filter((p) => {
    const key = `${p.protocol}|${p.hostname}|${p.port ?? ""}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
