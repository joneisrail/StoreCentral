import type { ImageLoaderProps } from "next/dist/shared/lib/image-config"
import { resolveImageOrigin } from "./image-origin"

const MIN_WIDTH = 16
const MAX_WIDTH = 3840
const DEFAULT_QUALITY = 75

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)))

const isAbsoluteHttp = (src: string): boolean => /^https?:\/\//i.test(src)

const isRootRelative = (src: string): boolean =>
  src.startsWith("/") && !src.startsWith("//")

export const rewriteImageSrc = (src: string, origin: string | null): string => {
  if (!origin || !isAbsoluteHttp(src)) {
    return src
  }
  try {
    const url = new URL(src)
    if (!url.pathname.startsWith("/static/")) {
      return src
    }
    const target = new URL(origin)
    url.protocol = target.protocol
    url.hostname = target.hostname
    url.port = target.port
    return url.toString()
  } catch {
    return src
  }
}

const imageLoader = ({ src, width, quality }: ImageLoaderProps): string => {
  if (!isAbsoluteHttp(src) && !isRootRelative(src)) {
    return src
  }
  // Literal process.env reads so Next inlines them into the client bundle.
  const origin = resolveImageOrigin({
    NEXT_PUBLIC_IMAGE_ORIGIN: process.env.NEXT_PUBLIC_IMAGE_ORIGIN,
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL,
  })
  const url = encodeURIComponent(rewriteImageSrc(src, origin))
  const w = clamp(width, MIN_WIDTH, MAX_WIDTH)
  const q = clamp(quality ?? DEFAULT_QUALITY, 1, 100)
  return `/_next/image?url=${url}&w=${w}&q=${q}`
}

export default imageLoader
