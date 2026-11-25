// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"
import { Skeleton, SkeletonImage, SkeletonText } from "./index"

afterEach(cleanup)

describe("Skeleton", () => {
  it("is aria-hidden and pulses only with motion-safe", () => {
    const { container } = render(<Skeleton className="h-4" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.className).toContain("motion-safe:animate-pulse")
    expect(el.className).not.toMatch(/(^|\s)animate-pulse/)
    expect(el.className).toContain("h-4")
  })

  it("SkeletonText renders three bars by default and five when asked", () => {
    const a = render(<SkeletonText />)
    expect(a.container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true"
    )
    expect(a.container.querySelectorAll("[data-skeleton-bar]").length).toBe(3)
    const b = render(<SkeletonText lines={5} />)
    expect(b.container.querySelectorAll("[data-skeleton-bar]").length).toBe(5)
  })

  it("SkeletonImage defaults to 4/5 and accepts other ratios", () => {
    const a = render(<SkeletonImage />)
    const el = a.container.firstElementChild as HTMLElement
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.style.aspectRatio).toBe("4 / 5")
    const b = render(<SkeletonImage ratio="16/9" />)
    expect((b.container.firstElementChild as HTMLElement).style.aspectRatio).toBe(
      "16 / 9"
    )
  })
})
