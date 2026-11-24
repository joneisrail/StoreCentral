"use client"

import { useEffect } from "react"

// Shown when a server component throws, for example when the store backend is
// unreachable. The digest lets the failure be matched to the server log without
// putting the error text in front of shoppers.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Storefront page error", error.digest ?? "")
  }, [error])

  return (
    <div
      role="alert"
      className="flex flex-col gap-4 items-center justify-center min-h-[calc(100vh-64px)]"
    >
      <h1 className="text-2xl-semi text-ui-fg-base">Something went wrong</h1>
      <p className="text-small-regular text-ui-fg-base">
        We could not load this page. Please try again in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="text-ui-fg-interactive text-small-regular"
      >
        Try again
      </button>
    </div>
  )
}
