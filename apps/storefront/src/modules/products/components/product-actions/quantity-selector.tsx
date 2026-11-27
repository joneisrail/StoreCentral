"use client"

import { useEffect, useState } from "react"

type QuantitySelectorProps = {
  value: number
  onChange: (n: number) => void
  max: number | null
}

const MAX_PER_ORDER = 10

const buttonClass =
  "inline-flex h-11 w-11 items-center justify-center text-lg text-charcoal transition-colors motion-reduce:transition-none hover:bg-ivory disabled:cursor-not-allowed disabled:text-warm-grey focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep"

const QuantitySelector = ({ value, onChange, max }: QuantitySelectorProps) => {
  const limit = Math.max(1, Math.min(MAX_PER_ORDER, max ?? MAX_PER_ORDER))
  const clamp = (n: number) => Math.min(limit, Math.max(1, n))
  // Local text lets the field be emptied while typing; it resyncs on blur.
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  return (
    <div
      className="inline-flex items-center rounded-base border border-line-strong bg-paper"
      data-testid="quantity-selector"
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        className={buttonClass}
        disabled={value <= 1}
        onClick={() => onChange(clamp(value - 1))}
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Quantity"
        value={text}
        onBlur={() => setText(String(value))}
        className="h-11 w-12 bg-transparent text-center text-base text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "")
          if (digits === "") {
            setText("")
            return
          }
          const next = clamp(parseInt(digits, 10))
          setText(String(next))
          if (next !== value) onChange(next)
        }}
      />
      <button
        type="button"
        aria-label="Increase quantity"
        className={buttonClass}
        disabled={value >= limit}
        onClick={() => onChange(clamp(value + 1))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}

export default QuantitySelector
