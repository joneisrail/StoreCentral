"use client"

import clsx from "clsx"
import { useState } from "react"
import { useRefinementList } from "react-instantsearch"

type RefinementGroupProps = {
  attribute: string
  title: string
}

const INITIAL_LIMIT = 20
const SHOW_MORE_LIMIT = 200

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2"

const RefinementGroup = ({ attribute, title }: RefinementGroupProps) => {
  const [query, setQuery] = useState("")
  const {
    items,
    refine,
    searchForItems,
    toggleShowMore,
    canToggleShowMore,
    isShowingMore,
  } = useRefinementList({
    attribute,
    limit: INITIAL_LIMIT,
    showMore: true,
    showMoreLimit: SHOW_MORE_LIMIT,
    sortBy: ["count:desc", "name:asc"],
  })

  // The box stays up while a query is typed so a search with no matches does
  // not remove the field the shopper is typing in.
  const searchable =
    canToggleShowMore || isShowingMore || items.length > INITIAL_LIMIT
  const showSearch = searchable || query !== ""

  if (!items.length && !showSearch) {
    return null
  }

  const handleSearch = (value: string) => {
    setQuery(value)
    searchForItems(value)
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-y-3 border-0 p-0">
      <legend className="mb-3 p-0 txt-compact-small-plus text-warm-grey">
        {title}
      </legend>
      {showSearch && (
        <input
          type="search"
          value={query}
          onChange={(event) => handleSearch(event.target.value)}
          aria-label={`Search ${title}`}
          placeholder={`Search ${title.toLowerCase()}`}
          className={clsx(
            "mr-6 min-h-[44px] rounded-soft border border-line bg-paper px-3 text-sm text-charcoal lg:min-h-0 lg:py-1.5",
            FOCUS_RING
          )}
          data-testid={`refinement-search-${attribute}`}
        />
      )}
      <ul className="flex flex-col gap-y-2 pr-6">
        {items.map((item) => (
          <li key={item.value}>
            <label className="flex cursor-pointer items-start gap-x-2">
              <input
                type="checkbox"
                checked={item.isRefined}
                onChange={() => {
                  refine(item.value)
                  handleSearch("")
                }}
                className="mt-1 shrink-0 accent-gold-deep"
                data-testid={`refinement-${attribute}`}
              />
              <span
                className={clsx("text-small-regular min-w-0 break-words", {
                  "text-charcoal": item.isRefined,
                  "text-warm-grey": !item.isRefined,
                })}
              >
                {item.label}
              </span>
              <span className="text-small-regular shrink-0 text-warm-grey">
                ({item.count})
              </span>
            </label>
          </li>
        ))}
      </ul>
      {(canToggleShowMore || isShowingMore) && (
        <button
          type="button"
          onClick={toggleShowMore}
          aria-expanded={isShowingMore}
          className={clsx(
            "min-h-[44px] self-start rounded-soft px-1 text-left txt-compact-small-plus text-charcoal underline underline-offset-2 hover:text-gold-deep lg:min-h-0",
            FOCUS_RING
          )}
          data-testid={`refinement-show-more-${attribute}`}
        >
          {isShowingMore ? "Show less" : "Show more"}
        </button>
      )}
    </fieldset>
  )
}

export default RefinementGroup
