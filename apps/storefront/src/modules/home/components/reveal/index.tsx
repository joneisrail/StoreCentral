"use client"

import { ReactNode, useEffect, useRef, useState } from "react"

type RevealState = "plain" | "hidden" | "shown"

const FAIL_OPEN_MS = 3000

const Reveal = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<RevealState>("plain")

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return
    }
    let observer: IntersectionObserver | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (
        typeof IntersectionObserver === "undefined" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return
      }
      if (node.getBoundingClientRect().top < window.innerHeight) {
        return
      }
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState("shown")
          observer?.disconnect()
        }
      })
      observer.observe(node)
      setState("hidden")
      timer = setTimeout(() => setState("shown"), FAIL_OPEN_MS)
    } catch {
      setState("plain")
    }
    return () => {
      observer?.disconnect()
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  const motion =
    state === "hidden"
      ? "motion-safe:opacity-0 motion-safe:translate-y-4"
      : state === "shown"
        ? "motion-safe:transition motion-safe:duration-700 motion-safe:opacity-100 motion-safe:translate-y-0"
        : ""

  return (
    <div ref={ref} className={[motion, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  )
}

export default Reveal
