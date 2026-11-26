"use client"

import clsx from "clsx"
import type { ReactNode } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { CatalogView } from "../store-hits/view-state"

type ViewToggleProps = {
  view: CatalogView
  onChange?: (view: CatalogView) => void
  hrefFor?: (view: CatalogView) => string
}

const ICONS: Record<CatalogView, ReactNode> = {
  grid: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="3" width="5.5" height="5.5" />
      <rect x="11.5" y="3" width="5.5" height="5.5" />
      <rect x="3" y="11.5" width="5.5" height="5.5" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" />
    </svg>
  ),
  list: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  ),
}

const LABELS: Record<CatalogView, string> = {
  grid: "Grid view",
  list: "List view",
}

const VIEWS: CatalogView[] = ["grid", "list"]

const ViewToggle = ({ view, onChange, hrefFor }: ViewToggleProps) => (
  <div className="flex items-center gap-1" data-testid="view-toggle">
    {VIEWS.map((option) => {
      const active = option === view
      const className = clsx(
        "inline-flex h-11 w-11 items-center justify-center rounded-soft border transition-colors motion-reduce:transition-none lg:h-9 lg:w-9",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory",
        active
          ? "border-charcoal bg-charcoal text-paper"
          : "border-line-strong bg-paper text-charcoal hover:bg-ivory"
      )

      if (hrefFor) {
        return (
          <LocalizedClientLink
            key={option}
            href={hrefFor(option)}
            aria-label={LABELS[option]}
            aria-current={active ? "true" : undefined}
            className={className}
          >
            {ICONS[option]}
          </LocalizedClientLink>
        )
      }

      return (
        <button
          key={option}
          type="button"
          aria-label={LABELS[option]}
          aria-pressed={active}
          onClick={() => onChange?.(option)}
          className={className}
        >
          {ICONS[option]}
        </button>
      )
    })}
  </div>
)

export default ViewToggle
