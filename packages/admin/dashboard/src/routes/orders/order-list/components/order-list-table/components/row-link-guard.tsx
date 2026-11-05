import { ReactNode } from "react"

/**
 * Wraps an interactive control rendered inside `_DataTable`'s per-cell row
 * `Link` (`navigateTo`), so clicking it does not open the order detail page.
 *
 * `stopPropagation` alone only keeps react-router's `Link` onClick from
 * running; the `<a href>` itself is still followed natively by Chrome (a
 * button inside an anchor), loading the detail page. Cancelling the default
 * here runs after the control's own handlers, notably Radix's open-toggle,
 * which skips itself once `defaultPrevented` is set - so the control inside
 * must not stop the click from reaching this wrapper.
 */
export const RowLinkGuard = ({
  children,
  className = "inline-flex",
}: {
  children: ReactNode
  className?: string
}) => (
  <span
    className={className}
    onClick={(e) => {
      e.preventDefault()
      e.stopPropagation()
    }}
  >
    {children}
  </span>
)
