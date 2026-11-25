// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

import Hero from "./index"

afterEach(cleanup)

describe("Hero", () => {
  it("renders headline and CTA without image", () => {
    const { container } = render(
      <Hero
        content={{
          headline: "Discover",
          cta: { label: "Shop all", href: "/store" },
        }}
      />
    )
    expect(container.querySelector("h1")?.textContent).toBe("Discover")
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/store")
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector('[data-testid="home-hero"]')).not.toBeNull()
  })

  it("hides the image on error but keeps the headline", () => {
    const { container } = render(
      <Hero
        content={{
          headline: "Discover",
          image: { src: "/hero.jpg", alt: "A bottle" },
        }}
      />
    )
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("A bottle")
    act(() => {
      img.dispatchEvent(new Event("error"))
    })
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("h1")?.textContent).toBe("Discover")
  })

  it("renders a 200 character headline", () => {
    const headline = "x".repeat(200)
    const { container } = render(<Hero content={{ headline }} />)
    expect(container.querySelector("h1")?.textContent).toBe(headline)
  })
})
