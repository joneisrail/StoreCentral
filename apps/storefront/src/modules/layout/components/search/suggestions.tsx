"use client"

import { XMark } from "@medusajs/icons"

import { Thumbnail } from "./hit"
import { Group, Option, type RowHandlers } from "./option"
import type { Section } from "./rows"

type SuggestionsProps = RowHandlers & { sections: Section[] }

/**
 * The empty-input state inside the listbox: recent searches, popular searches
 * and trending products, options only. Sections without data are dropped
 * before they get here. Recent rows have a fixed height so `RecentControls`,
 * rendered outside the listbox, lines up with them.
 */
const Suggestions = ({ sections, ...handlers }: SuggestionsProps) => (
  <>
    {sections.map((section) => (
      <Group key={section.key} section={section} testId={`search-${section.key}`}>
        {section.rows.map((row) => {
          if (row.kind === "trending") {
            return (
              <Option key={row.id} row={row} {...handlers}>
                <Thumbnail src={row.product.thumbnail} />
                <span className="line-clamp-2">{row.product.title}</span>
              </Option>
            )
          }
          if (row.kind === "recent") {
            return (
              <Option key={row.id} row={row} {...handlers} className="h-11 pr-14">
                <span className="truncate">{row.query}</span>
              </Option>
            )
          }
          if (row.kind === "popular") {
            return (
              <Option key={row.id} row={row} {...handlers}>
                {row.query}
              </Option>
            )
          }
          return null
        })}
      </Group>
    ))}
  </>
)

type RecentControlsProps = {
  queries: string[]
  onRemove: (query: string) => void
  onClear: () => void
}

/**
 * "Clear" and the per-row remove buttons for recent searches. A listbox may
 * hold only options, so these sit beside it, laid over the recent group (the
 * first section when present): the group's padding, then one 44px row for the
 * heading and one per recent search.
 */
export const RecentControls = ({
  queries,
  onRemove,
  onClear,
}: RecentControlsProps) => (
  <div
    className="pointer-events-none absolute right-0 top-0 flex flex-col items-end pr-2 pt-2"
    data-testid="search-recent-controls"
  >
    <button
      type="button"
      onClick={onClear}
      aria-label="Clear recent searches"
      className="pointer-events-auto h-11 px-2 text-sm text-warm-grey underline-offset-4 hover:text-gold-deep hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-deep"
      data-testid="search-recent-clear"
    >
      Clear
    </button>
    {queries.map((query) => (
      <button
        key={query}
        type="button"
        onClick={() => onRemove(query)}
        aria-label={`Remove ${query} from recent searches`}
        className="pointer-events-auto flex h-11 w-11 items-center justify-center text-warm-grey hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-deep"
      >
        <XMark />
      </button>
    ))}
  </div>
)

export default Suggestions
