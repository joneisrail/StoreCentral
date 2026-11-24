"use client"

// Last resort for errors in the root layout, where the regular error boundary
// cannot render. It replaces the whole document, so it carries its own html.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body>
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            minHeight: "100vh",
            fontFamily: "sans-serif",
          }}
        >
          <h1>Something went wrong</h1>
          <p>The store is temporarily unavailable. Please try again shortly.</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
