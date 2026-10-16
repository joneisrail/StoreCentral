"use client"

import Link from "next/link"
import React from "react"

/**
 * A thin wrapper around Next.js `<Link />`. The storefront is single-region,
 * so hrefs are used as-is; the middleware rewrites every request to the
 * matching `[countryCode]` route segment internally without it ever showing
 * up in the URL.
 */
const LocalizedClientLink = ({
  children,
  href,
  ...props
}: {
  children?: React.ReactNode
  href: string
  className?: string
  onClick?: () => void
  passHref?: true
  [x: string]: unknown
}) => {
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  )
}

export default LocalizedClientLink
