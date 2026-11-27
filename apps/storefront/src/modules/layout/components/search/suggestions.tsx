"use client"

import { XMark } from "@medusajs/icons"

import { Thumbnail } from "./hit"
import { Group, Option, type RowHandlers } from "./option"
import type { Section } from "./rows"

type SuggestionsProps = RowHandlers & {
  sections: Section[]
  onRemoveRecent: (query: string) => void
  onClearRecent: () => void
}

/**
 * The empty-input state: recent searches, popular searches and trending
 * products. Sections without data are dropped before they get here.
 */
const Suggestions = ({
  sections,
  onRemoveRecent,
  onClearRecent,
  ...handlers
}: SuggestionsProps) => (
  <>
    {sections.map((section) => (
      <Group
        key={section.key}
        section={section}
        testId={`search-${section.key}`}
        action={
          section.key === "recent" ? (
            <button
              type="button"
              onClick={onClearRecent}
              className="min-h-[44px] px-2 text-sm text-warm-grey underline-offset-4 hover:text-gold-deep hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-deep"
              data-testid="search-recent-clear"
            >
              Clear
            </button>
          ) : undefined
        }
      >
        {section.rows.map((row) => {
          if (row.kind === "trending") {
            return (
              <Option key={row.id} row={row} {...handlers}>
                <Thumbnail src={row.product.thumbnail} />
                <span className="line-clamp-2">{row.product.title}</span>
              </Option>
            )
          }
          if (row.kind !== "recent" && row.kind !== "popular") {
            return null
          }
          const option = (
            <Option
              key={row.id}
              row={row}
              {...handlers}
              className={row.kind === "recent" ? "flex-1" : undefined}
            >
              {row.query}
            </Option>
          )
          return row.kind === "recent" ? (
            <div key={row.id} className="flex items-center pr-2">
              {option}
              <button
                type="button"
                onClick={() => onRemoveRecent(row.query)}
                aria-label={`Remove ${row.query} from recent searches`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center text-warm-grey hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-deep"
              >
                <XMark />
              </button>
            </div>
          ) : (
            option
          )
        })}
      </Group>
    ))}
  </>
)

export default Suggestions
