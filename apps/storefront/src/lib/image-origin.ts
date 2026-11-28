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

const STATIC_PATTERNS: RemotePattern[] = [
  { protocol: "http", hostname: "localhost" },
  { protocol: "https", hostname: "*.s3.*.amazonaws.com" },
  { protocol: "https", hostname: "*.s3.amazonaws.com" },
]

export const buildRemotePatterns = (
  env: Env = process.env
): RemotePattern[] => {
  const patterns: RemotePattern[] = []
  const origin = resolveImageOrigin(env)
  if (origin) {
    const url = new URL(origin)
    patterns.push({
      protocol: url.protocol === "https:" ? "https" : "http",
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
    })
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
