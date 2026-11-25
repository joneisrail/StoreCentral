"use client"

import clsx from "clsx"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

type Tone = "info" | "success" | "error"

type ToastInput = {
  title: string
  description?: string
  tone?: Tone
  durationMs?: number
}

type ToastItem = ToastInput & { id: string }

type ToastApi = {
  toast: (t: ToastInput) => string
  dismiss: (id: string) => void
}

const DEFAULT_DURATION_MS = 5000

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}

const toneBorder: Record<Tone, string> = {
  info: "border-l-charcoal",
  success: "border-l-gold-deep",
  error: "border-l-red-700",
}

function ToastView({
  item,
  onDismiss,
}: {
  item: ToastItem
  onDismiss: (id: string) => void
}) {
  const tone = item.tone ?? "info"
  const duration = item.durationMs ?? DEFAULT_DURATION_MS
  const [paused, setPaused] = useState(false)
  const remaining = useRef(duration)

  useEffect(() => {
    if (paused) {
      return
    }
    const startedAt = Date.now()
    const timer = setTimeout(() => onDismiss(item.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused, item.id, onDismiss])

  return (
    <div
      data-toast=""
      role={tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false)
        }
      }}
      className={clsx(
        "pointer-events-auto flex items-start gap-3 rounded-rounded border border-line border-l-4 bg-paper p-4 text-charcoal shadow-md",
        "motion-safe:transition-opacity motion-safe:duration-200",
        toneBorder[tone]
      )}
    >
      <div className="flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        {item.description ? (
          <p className="mt-1 text-sm text-warm-grey">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
        className="-m-2 flex h-11 w-11 items-center justify-center rounded-soft text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 lg:m-0 lg:h-8 lg:w-8"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((t: ToastInput) => {
    counter.current += 1
    const id = `toast-${counter.current}`
    setItems((prev) => [...prev, { ...t, id }])
    return id
  }, [])

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex max-h-[40dvh] flex-col gap-2 overflow-y-auto p-4 lg:max-h-screen lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:w-96"
      >
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
