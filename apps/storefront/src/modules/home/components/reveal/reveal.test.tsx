// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../../test/render"

import Reveal from "./index"

const g = globalThis as unknown as { IntersectionObserver?: unknown }
const original = g.IntersectionObserver
const originalMatchMedia = window.matchMedia

afterEach(() => {
  cleanup()
  g.IntersectionObserver = original
  window.matchMedia = originalMatchMedia
  vi.restoreAllMocks()
})

const mockMedia = (reduce: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: reduce,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe("Reveal", () => {
  it("shows children with no IntersectionObserver", () => {
    delete g.IntersectionObserver
    mockMedia(false)
    const { container } = render(
      <Reveal>
        <p>hello</p>
      </Reveal>
    )
    expect(container.textContent).toContain("hello")
    expect(container.innerHTML).not.toContain("opacity-0")
  })

  it("shows children under reduced motion", () => {
    g.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    }
    mockMedia(true)
    const { container } = render(
      <Reveal>
        <p>hello</p>
      </Reveal>
    )
    expect(container.textContent).toContain("hello")
    expect(container.innerHTML).not.toContain("opacity-0")
  })

  it("shows children when the observer throws", () => {
    g.IntersectionObserver = class {
      constructor() {
        throw new Error("boom")
      }
    }
    mockMedia(false)
    const { container } = render(
      <Reveal>
        <p>hello</p>
      </Reveal>
    )
    expect(container.textContent).toContain("hello")
    expect(container.innerHTML).not.toContain("opacity-0")
  })
})
