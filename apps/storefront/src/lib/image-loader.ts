import type { ImageLoaderProps } from "next/image"
// RemotePattern has no public export from next, hence the dist path.
import type { RemotePattern } from "next/dist/shared/lib/image-config"
import { buildRemotePatterns, resolveImageOrigin } from "./image-origin"

const MIN_WIDTH = 16
const MAX_WIDTH = 3840
const DEFAULT_QUALITY = 75
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "")

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  if (isBlank(value)) {
    return fallback
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(n)))
}

const isAbsoluteHttp = (src: string): boolean => /^https?:\/\//i.test(src)

const isRootRelative = (src: string): boolean =>
  src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/\\")

export const rewriteImageSrc = (
  src: string,
  origin: string | null,
  knownHosts: string[] = []
): string => {
  if (!origin || !isAbsoluteHttp(src)) {
    return src
  }
  try {
    const url = new URL(src)
    const target = new URL(origin)
    const allowed = [...LOCAL_HOSTS, target.hostname, ...knownHosts]
    if (!url.pathname.startsWith("/static/") || !allowed.includes(url.hostname)) {
      return src
    }
    url.protocol = target.protocol
    url.hostname = target.hostname
    url.port = target.port
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return src
  }
}

const backendHost = (value: string | undefined): string[] => {
  try {
    return value?.trim() ? [new URL(value.trim()).hostname] : []
  } catch {
    return []
  }
}

/**
 * Mirrors Next's matchRemotePattern for the patterns buildRemotePatterns
 * produces: exact protocol and hostname (no wildcards are generated), and the
 * port only when the pattern pins one.
 */
const matchesPattern = (url: URL, pattern: RemotePattern): boolean => {
  if (pattern.protocol && url.protocol !== `${pattern.protocol}:`) {
    return false
  }
  if (pattern.port !== undefined && url.port !== pattern.port) {
    return false
  }
  return url.hostname === pattern.hostname
}

/**
 * Whether /_next/image will fetch this src. Root-relative paths are served
 * from public/; an absolute url only when its (rewritten) host is in the
 * optimiser's remotePatterns. Anything else would answer 400.
 */
export const isServedByOptimiser = (
  src: string,
  patterns: RemotePattern[]
): boolean => {
  if (isRootRelative(src)) {
    return true
  }
  try {
    const url = new URL(src)
    return patterns.some((pattern) => matchesPattern(url, pattern))
  } catch {
    return false
  }
}

export type ImageLoaderEnv = {
  imageOrigin: string | undefined
  backendUrl: string | undefined
  nodeEnv: string | undefined
}

/**
 * The pure loader: env-derived values come in as parameters. A src on a host
 * the optimiser does not serve (a channel import on cdn.shopify.com, a
 * category image on any https host) is returned unchanged, so the browser
 * loads it directly and unoptimised instead of getting a 400.
 *
 * MEDUSA_CLOUD_S3_HOSTNAME is not NEXT_PUBLIC, so the client bundle cannot
 * see it: S3-Cloud images load directly unless NEXT_PUBLIC_IMAGE_ORIGIN is
 * set to that host.
 */
export const buildImageUrl = (
  { src, width, quality }: ImageLoaderProps,
  env: ImageLoaderEnv
): string => {
  if (!isAbsoluteHttp(src) && !isRootRelative(src)) {
    return src
  }
  const originEnv = {
    NODE_ENV: env.nodeEnv,
    NEXT_PUBLIC_IMAGE_ORIGIN: env.imageOrigin,
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: env.backendUrl,
  }
  const origin = resolveImageOrigin(originEnv)
  const rewritten = rewriteImageSrc(src, origin, backendHost(env.backendUrl))
  if (!isServedByOptimiser(rewritten, buildRemotePatterns(originEnv))) {
    return rewritten
  }
  const url = encodeURIComponent(rewritten)
  const w = clamp(width, MIN_WIDTH, MAX_WIDTH, MIN_WIDTH)
  const q = clamp(quality, 1, 100, DEFAULT_QUALITY)
  return `/_next/image?url=${url}&w=${w}&q=${q}`
}

const imageLoader = (props: ImageLoaderProps): string =>
  buildImageUrl(props, {
    // Literal process.env reads so Next inlines them into the client bundle.
    imageOrigin: process.env.NEXT_PUBLIC_IMAGE_ORIGIN,
    backendUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL,
    nodeEnv: process.env.NODE_ENV,
  })

export default imageLoader
