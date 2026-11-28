"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

import useSearchSettled from "@lib/hooks/use-search-settled"
import type { CatalogView } from "./store-hits/view-state"

// Space for the whole region under the page heading (toolbar plus a first page
// of 12 products) before InstantSearch has any hits, so the footer does not
// jump when they arrive. Card = 4/5 image + ~100px of title, price and button;
// row gap 32px; the toolbar (search box, count, sort) adds ~70px.
//   grid, < small (2 cols, 6 rows): ~358px wide -> 167px column -> 209px image
//     + 100 = ~309px; 6 x 309 + 5 x 32 = ~2014, + 70 = ~2084 -> 2000.
//   grid, small (3 cols, 4 rows): ~694px wide -> 215px column -> 269px image
//     + 100 = ~369px; 4 x 369 + 3 x 32 = ~1572, + 70 = ~1642 -> 1550.
//   grid, medium (4 cols, 3 rows): ~940px wide -> 217px column -> 271px image
//     + 100 = ~371px; 3 x 371 + 2 x 32 = ~1177, + 70 = ~1247 -> 1200.
//   list: rows vary widely with the viewport, so a smaller fixed reserve.
// Rounded down on purpose: undershooting is better than a blank gap.
const GRID_RESERVE = "min-h-[2000px] small:min-h-[1550px] medium:min-h-[1200px]"
const LIST_RESERVE = "min-h-[1250px]"

const SettledContext = createContext<(() => void) | null>(null)

/**
 * Wraps the <InstantSearch> provider. It lives OUTSIDE it on purpose: the
 * provider renders no children on the server, so a reserve held inside would
 * only appear after hydration, too late to stop the footer jumping. Holds a
 * min-height until a SettledReporter inside reports the first settled result
 * set (zero hits included); it never comes back on later refinements.
 */
export const ReserveResultsSpace = ({
  view = "grid",
  children,
}: {
  view?: CatalogView
  children: ReactNode
}) => {
  const [settled, setSettled] = useState(false)
  const reserve = settled
    ? ""
    : view === "list"
      ? LIST_RESERVE
      : GRID_RESERVE

  return (
    <SettledContext.Provider value={() => setSettled(true)}>
      <div className={reserve} data-testid="results-reserve">
        {children}
      </div>
    </SettledContext.Provider>
  )
}

/** Render inside <InstantSearch>: tells the reserve the first results landed. */
export const SettledReporter = () => {
  const { isSettled } = useSearchSettled()
  const report = useContext(SettledContext)

  useEffect(() => {
    if (isSettled) {
      report?.()
    }
  }, [isSettled, report])

  return null
}

export default ReserveResultsSpace
