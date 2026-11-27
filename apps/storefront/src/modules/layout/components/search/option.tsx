"use client"

import { clx } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { ReactNode } from "react"
import type { Row, Section } from "./rows"

export type RowHandlers = {
  activeId: string | undefined
  onSelect: (row: Row) => void
}

type OptionProps = RowHandlers & {
  row: Row
  className?: string
  children: ReactNode
}

/**
 * A listbox option. Focus stays in the input (`aria-activedescendant` points
 * here), so options are not tab stops. A click records the selection and lets
 * the link navigate.
 */
export const Option = ({
  row,
  activeId,
  onSelect,
  className,
  children,
}: OptionProps) => {
  const active = row.id === activeId
  return (
    <LocalizedClientLink
      href={row.href}
      id={row.id}
      role="option"
      aria-selected={active}
      data-kind={row.kind}
      tabIndex={-1}
      onClick={() => onSelect(row)}
      className={clx(
        "flex min-h-[44px] items-center gap-x-3 px-4 py-2 text-charcoal hover:bg-paper",
        active && "bg-paper outline outline-1 -outline-offset-1 outline-line-strong",
        className
      )}
    >
      {children}
    </LocalizedClientLink>
  )
}

type GroupProps = {
  section: Section
  action?: ReactNode
  testId?: string
  children: ReactNode
}

/** A titled group of options; the title labels the group. */
export const Group = ({ section, action, testId, children }: GroupProps) => {
  const labelId = section.title ? `${section.rows[0]?.id}-label` : undefined
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="border-b border-line py-2 last:border-b-0"
      data-testid={testId}
    >
      {section.title && (
        <div className="flex items-center justify-between px-4 pb-1 pt-2">
          <span
            id={labelId}
            className="font-serif text-sm uppercase tracking-wider text-warm-grey"
          >
            {section.title}
          </span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
