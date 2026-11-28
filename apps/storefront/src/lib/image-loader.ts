import type { ImageLoaderProps } from "next/image"
import { resolveImageOrigin } from "./image-origin"

const MIN_WIDTH = 16
const MAX_WIDTH = 3840
const DEFAULT_QUALITY = 75
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
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

const imageLoader = ({ src, width, quality }: ImageLoaderProps): string => {
  if (!isAbsoluteHttp(src) && !isRootRelative(src)) {
    return src
  }
  // Literal process.env reads so Next inlines them into the client bundle.
  const imageOrigin = process.env.NEXT_PUBLIC_IMAGE_ORIGIN
  const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  const origin = resolveImageOrigin({
    NEXT_PUBLIC_IMAGE_ORIGIN: imageOrigin,
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: backendUrl,
  })
  const url = encodeURIComponent(rewriteImageSrc(src, origin, backendHost(backendUrl)))
  const w = clamp(width, MIN_WIDTH, MAX_WIDTH, MIN_WIDTH)
  const q = clamp(quality, 1, 100, DEFAULT_QUALITY)
  return `/_next/image?url=${url}&w=${w}&q=${q}`
}

export default imageLoader
