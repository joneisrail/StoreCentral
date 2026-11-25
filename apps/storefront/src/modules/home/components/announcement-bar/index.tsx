"use client"

import { useEffect, useState } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"

const AnnouncementBar = ({ text, href }: { text: string; href?: string }) => {
  const key = `sc-announcement-dismissed:${text}`
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(key)) {
        setDismissed(true)
      }
    } catch {
      // storage unavailable: keep the bar visible
    }
  }, [key])

  const dismiss = () => {
    setDismissed(true)
    try {
      window.sessionStorage.setItem(key, "1")
    } catch {
      // storage unavailable: dismissal lasts for this page view only
    }
  }

  if (dismissed) {
    return null
  }

  const focus =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory"

  return (
    <div
      className="relative bg-charcoal text-ivory"
      data-testid="announcement-bar"
    >
      <div className="content-container flex items-center justify-center px-12 py-2 text-center text-sm font-sans">
        {href ? (
          <LocalizedClientLink
            href={href}
            className={`inline-flex min-h-[44px] items-center underline underline-offset-4 lg:min-h-0 ${focus}`}
          >
            {text}
          </LocalizedClientLink>
        ) : (
          <span>{text}</span>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={dismiss}
        className={`absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ivory transition-colors hover:bg-[rgb(250_247_242/0.15)] motion-reduce:transition-none ${focus}`}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
      </button>
    </div>
  )
}

export default AnnouncementBar
