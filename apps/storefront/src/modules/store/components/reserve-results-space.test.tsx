// @vitest-environment jsdom
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../test/render"
import ReserveResultsSpace, { SettledReporter } from "./reserve-results-space"

let search: { status: string; results: unknown } = {
  status: "loading",
  results: { __isArtificial: true },
}
vi.mock("react-instantsearch", () => ({ useInstantSearch: () => search }))

afterEach(cleanup)

const reserve = () =>
  document.querySelector("[data-testid=results-reserve]") as HTMLElement

const tree = (view: "grid" | "list" = "grid") => (
  <ReserveResultsSpace view={view}>
    <SettledReporter />
    <p>child</p>
  </ReserveResultsSpace>
)

describe("ReserveResultsSpace", () => {
  it("carries the reserve in the server render, before any search status", () => {
    const html = renderToString(tree())
    expect(html).toContain("min-h-[2000px]")
    expect(html).toContain("medium:min-h-[1200px]")
  })

  it("uses a smaller reserve for the list view", () => {
    const html = renderToString(tree("list"))
    expect(html).toContain("min-h-[1250px]")
    expect(html).not.toContain("min-h-[2000px]")
  })

  it("keeps the reserve while loading or on artificial results", () => {
    search = { status: "idle", results: { __isArtificial: true } }
    render(tree())
    expect(reserve().className).toContain("min-h-[")
  })

  it("drops the reserve once results settle", () => {
    search = { status: "idle", results: { nbHits: 12 } }
    render(tree())
    expect(reserve().className).not.toContain("min-h-")
  })

  it("drops the reserve for a settled zero-hit result", () => {
    search = { status: "idle", results: { nbHits: 0 } }
    render(tree())
    expect(reserve().className).not.toContain("min-h-")
  })

  it("does not bring the reserve back on a later refinement", () => {
    search = { status: "idle", results: { nbHits: 12 } }
    const { rerender } = render(tree())
    search = { status: "loading", results: { nbHits: 12 } }
    rerender(tree())
    expect(reserve().className).not.toContain("min-h-")
  })
})
