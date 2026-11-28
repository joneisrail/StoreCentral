"use client"

import { useRef, type ReactNode } from "react"

import useSearchSettled from "@lib/hooks/use-search-settled"
import type { CatalogView } from "./store-hits/view-state"

// Space for a first page (12 products) before InstantSearch has any hits, so
// the footer does not jump down when they arrive. Heights are card height
// (4/5 image + ~100px title, price and button) per row, plus 32px row gaps.
// Column widths assume the 1280px content container minus the 250px filter
// aside and 32px gap where the aside shows.
//   grid, < small (2 cols, 6 rows): ~358px wide -> 167px column ->
//     209px image + 100 = ~309px; 6 x 309 + 5 x 32 = ~2014 -> 1900 (the
//     reserve may undershoot a little, never overshoot into a blank gap).
//   grid, small (3 cols, 4 rows): ~694px wide -> 215px column ->
//     269px image + 100 = ~369px; 4 x 369 + 3 x 32 = ~1572 -> 1500.
//   grid, medium (4 cols, 3 rows): ~940px wide -> 217px column ->
//     271px image + 100 = ~371px; 3 x 371 + 2 x 32 = ~1177 -> 1150.
//   list: rows vary widely with the viewport, so a smaller fixed reserve.
const GRID_RESERVE = "min-h-[1900px] small:min-h-[1500px] medium:min-h-[1150px]"
const LIST_RESERVE = "min-h-[1200px]"

type Props = {
  view?: CatalogView
  children: ReactNode
}

/**
 * The results column. Holds a min-height only until the first result set has
 * settled (any settled set, including zero hits), then lets content decide so
 * short results leave no blank space. Later refinements never bring it back.
 */
const ReserveResultsSpace = ({ view = "grid", children }: Props) => {
  const { isSettled } = useSearchSettled()
  const everSettled = useRef(false)

  if (isSettled) {
    everSettled.current = true
  }

  const reserve = everSettled.current
    ? ""
    : view === "list"
      ? LIST_RESERVE
      : GRID_RESERVE

  return (
    <div
      className={`w-full min-w-0 ${reserve}`.trim()}
      data-testid="results-column"
    >
      {children}
    </div>
  )
}

export default ReserveResultsSpace
