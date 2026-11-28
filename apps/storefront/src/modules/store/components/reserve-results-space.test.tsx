import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import ReserveResultsSpace from "./reserve-results-space"

describe("ReserveResultsSpace", () => {
  it("renders a viewport-high minimum and its children on the server", () => {
    const html = renderToString(
      <ReserveResultsSpace>
        <p>child</p>
      </ReserveResultsSpace>
    )
    expect(html).toContain("min-h-[100svh]")
    expect(html).toContain("child")
  })
})
