// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../test/render"
import ReserveResultsSpace from "./reserve-results-space"

let search: { status: string; results: unknown } = {
  status: "loading",
  results: { __isArtificial: true, nbHits: 0 },
}
vi.mock("react-instantsearch", () => ({ useInstantSearch: () => search }))

afterEach(cleanup)

const wrapper = () =>
  document.querySelector("[data-testid=results-column]") as HTMLElement

const mount = (view: "grid" | "list" = "grid") =>
  render(
    <ReserveResultsSpace view={view}>
      <p>child</p>
    </ReserveResultsSpace>
  )

describe("ReserveResultsSpace", () => {
  it("reserves grid space while the first search is loading", () => {
    search = { status: "loading", results: { __isArtificial: true } }
    mount()
    expect(wrapper().className).toContain("min-h-[")
    expect(wrapper().textContent).toBe("child")
  })

  it("reserves space for artificial results even when idle", () => {
    search = { status: "idle", results: { __isArtificial: true } }
    mount()
    expect(wrapper().className).toContain("min-h-[")
  })

  it("uses a smaller reserve for the list view", () => {
    search = { status: "loading", results: { __isArtificial: true } }
    mount("list")
    expect(wrapper().className).toContain("min-h-[1200px]")
    expect(wrapper().className).not.toContain("min-h-[1900px]")
  })

  it("drops the reserve once results settle", () => {
    search = { status: "idle", results: { nbHits: 12 } }
    mount()
    expect(wrapper().className).not.toContain("min-h-")
  })

  it("drops the reserve for a settled zero-hit result", () => {
    search = { status: "idle", results: { nbHits: 0 } }
    mount()
    expect(wrapper().className).not.toContain("min-h-")
  })

  it("does not bring the reserve back on a later refinement", () => {
    search = { status: "idle", results: { nbHits: 12 } }
    const { rerender } = mount()
    search = { status: "loading", results: { nbHits: 12 } }
    rerender(
      <ReserveResultsSpace view="grid">
        <p>child</p>
      </ReserveResultsSpace>
    )
    expect(wrapper().className).not.toContain("min-h-")
  })
})
