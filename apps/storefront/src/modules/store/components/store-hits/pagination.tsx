"use client"

import { usePagination } from "react-instantsearch"

import { clx } from "@modules/common/components/ui"

const SearchPagination = () => {
  const { pages, currentRefinement, nbPages, refine } = usePagination({
    padding: 2,
  })

  if (nbPages <= 1) {
    return null
  }

  const renderPage = (page: number) => {
    const current = page === currentRefinement

    return (
      <button
        key={page}
        type="button"
        aria-label={`Page ${page + 1}`}
        aria-current={current ? "page" : undefined}
        disabled={current}
        onClick={() => refine(page)}
        className={clx(
          "inline-flex h-11 min-w-[44px] items-center justify-center rounded-soft px-2 text-base lg:h-9 lg:min-w-[36px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory",
          current
            ? "border border-charcoal bg-charcoal text-paper"
            : "text-warm-grey hover:bg-paper hover:text-charcoal"
        )}
      >
        {page + 1}
      </button>
    )
  }

  const renderEllipsis = (key: string) => (
    <span
      key={key}
      aria-hidden="true"
      className="inline-flex h-11 cursor-default items-center px-1 text-warm-grey lg:h-9"
    >
      ...
    </span>
  )

  const lastPage = nbPages - 1

  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex w-full justify-center"
    >
      <div
        className="flex flex-wrap items-center justify-center gap-1"
        data-testid="product-pagination"
      >
        {!pages.includes(0) && renderPage(0)}
        {!pages.includes(0) && !pages.includes(1) && renderEllipsis("start")}
        {pages.map(renderPage)}
        {!pages.includes(lastPage) &&
          !pages.includes(lastPage - 1) &&
          renderEllipsis("end")}
        {!pages.includes(lastPage) && renderPage(lastPage)}
      </div>
    </nav>
  )
}

export default SearchPagination
