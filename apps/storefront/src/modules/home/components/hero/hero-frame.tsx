"use client"

import Image from "next/image"
import { ReactNode, useState } from "react"

import type { Img } from "@lib/content/homepage"

// Owns the image-failed state so the text palette follows whether the image
// actually loaded. Children are server-rendered and inherit colour from the
// data-tone attribute through group variants.
const HeroFrame = ({
  image,
  children,
}: {
  image?: Img
  children: ReactNode
}) => {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(image) && !failed

  return (
    <section
      data-testid="home-hero"
      data-tone={showImage ? "light" : "dark"}
      className="group relative w-full overflow-hidden border-b border-line bg-gradient-to-b from-ivory to-line min-h-[420px] aspect-[4/5] xsmall:aspect-[16/10] small:aspect-[16/9] small:min-h-[480px]"
    >
      {showImage && image ? (
        <>
          <Image
            src={image.src}
            alt={image.alt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
            onError={() => setFailed(true)}
          />
          {/* Flat 0.65 charcoal overlay: worst case (white photo) composites
              to about rgb(109 108 106), ivory text on it is about 4.9:1. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[rgb(30_29_27/0.65)]"
          />
        </>
      ) : null}
      {children}
    </section>
  )
}

export default HeroFrame
