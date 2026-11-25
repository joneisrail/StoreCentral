// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

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

  describe("below the fold", () => {
    let callback: (entries: { isIntersecting: boolean }[]) => void = () => {}
    const setup = () => {
      g.IntersectionObserver = class {
        constructor(cb: typeof callback) {
          callback = cb
        }
        observe() {}
        disconnect() {}
      }
      mockMedia(false)
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        top: 5000,
      } as DOMRect)
      return render(
        <Reveal>
          <p>hello</p>
        </Reveal>
      )
    }

    it("hides then shows once intersecting", () => {
      const { container } = setup()
      expect(container.innerHTML).toContain("opacity-0")
      act(() => callback([{ isIntersecting: true }]))
      expect(container.innerHTML).not.toContain("opacity-0")
      expect(container.textContent).toContain("hello")
    })

    it("fails open after 3s", () => {
      vi.useFakeTimers()
      try {
        const { container } = setup()
        expect(container.innerHTML).toContain("opacity-0")
        act(() => {
          vi.advanceTimersByTime(2900)
        })
        expect(container.innerHTML).toContain("opacity-0")
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(container.innerHTML).not.toContain("opacity-0")
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
