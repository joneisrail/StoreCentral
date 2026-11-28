"use client"

import Image from "next/image"
import { useState } from "react"

import PlaceholderImage from "@modules/common/icons/placeholder-image"

type SafeImageProps = {
  src: string
  alt: string
  sizes: string
  className?: string
  priority?: boolean
  /** Only the qualities the optimiser allows (next.config images.qualities). */
  quality?: 60 | 75
  draggable?: boolean
  /** Icon size of the error placeholder (default 24). */
  placeholderSize?: number
}

/**
 * Fill-mode `next/image` for use inside a caller-owned aspect-ratio box.
 * A failed load renders the placeholder in the same box, so nothing shifts.
 */
const SafeImageInner = ({
  src,
  alt,
  sizes,
  className,
  priority = false,
  quality = 75,
  draggable,
  placeholderSize = 24,
}: SafeImageProps) => {
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="absolute inset-0 flex h-full w-full items-center justify-center">
        <span className="text-warm-grey">
          <PlaceholderImage size={placeholderSize} />
        </span>
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      quality={quality}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      className={className ?? "object-cover"}
      draggable={draggable}
      onError={() => setError(true)}
    />
  )
}

/** Keyed by src so a failed state never outlives the image that failed. */
const SafeImage = (props: SafeImageProps) => (
  <SafeImageInner key={props.src} {...props} />
)

export default SafeImage