import type { ReactNode } from "react"

/**
 * Wraps the <InstantSearch> provider and keeps a viewport-high minimum under
 * the page heading. react-instantsearch renders nothing on the server, so
 * without this box the footer sits right under the title and jumps down when
 * the client tree mounts. The minimum is permanent: a short or empty result
 * set must never collapse it, or the footer would jump back up into view.
 */
const ReserveResultsSpace = ({ children }: { children: ReactNode }) => (
  <div className="min-h-[100svh]" data-testid="results-reserve">
    {children}
  </div>
)

export default ReserveResultsSpace
