import { Container, clx } from "@modules/common/components/ui"
import SafeImage from "@modules/common/components/safe-image"
import React from "react"

import PlaceholderImage from "@modules/common/icons/placeholder-image"

const DEFAULT_SIZES =
  "(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"

type ThumbnailProps = {
  thumbnail?: string | null
  images?: { url?: string }[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  className?: string
  /** Responsive `sizes` hint for the image. */
  sizes?: string
  /** Alt text. Pass "" when the image is decorative (e.g. inside a labelled link). */
  alt?: string
  "data-testid"?: string
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  className,
  sizes,
  alt,
  "data-testid": dataTestid,
}) => {
  const initialImage = thumbnail || images?.[0]?.url

  return (
    <Container
      className={clx(
        "relative w-full overflow-hidden p-4 bg-paper border border-line rounded-soft motion-safe:transition-colors motion-safe:duration-150 group-hover:border-line-strong",
        className,
        {
          "aspect-[4/5]": size !== "square",
          "aspect-[1/1]": size === "square",
          "w-[180px]": size === "small",
          "w-[290px]": size === "medium",
          "w-[440px]": size === "large",
          "w-full": size === "full",
        }
      )}
      data-testid={dataTestid}
    >
      <ImageOrPlaceholder
        image={initialImage}
        size={size}
        sizes={sizes}
        alt={alt}
      />
    </Container>
  )
}

const ImageOrPlaceholder = ({
  image,
  size,
  sizes = DEFAULT_SIZES,
  alt = "Thumbnail",
}: Pick<ThumbnailProps, "size" | "sizes" | "alt"> & { image?: string }) => {
  return image ? (
    <SafeImage
      src={image}
      alt={alt}
      className="absolute inset-0 object-cover object-center"
      draggable={false}
      quality={60}
      sizes={sizes}
      placeholderSize={size === "small" ? 16 : 24}
    />
  ) : (
    <div className="w-full h-full absolute inset-0 flex items-center justify-center">
      <span className="text-warm-grey">
        <PlaceholderImage size={size === "small" ? 16 : 24} />
      </span>
    </div>
  )
}

export default Thumbnail
