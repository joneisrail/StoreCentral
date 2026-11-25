"use client"

import Image from "next/image"
import { useState } from "react"

import type { Img } from "@lib/content/homepage"

const HeroImage = ({ image }: { image: Img }) => {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return null
  }

  return (
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
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[rgb(30_29_27/0.65)] via-[rgb(30_29_27/0.35)] to-[rgb(30_29_27/0.15)]"
      />
    </>
  )
}

export default HeroImage
