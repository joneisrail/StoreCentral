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

  it("switches to the no-image palette after an image error", () => {
    const { container } = render(
      <Hero
        content={{
          eyebrow: "New",
          headline: "Discover",
          cta: { label: "Shop", href: "/store" },
          image: { src: "/hero.jpg", alt: "A bottle" },
        }}
      />
    )
    const tone = () =>
      container.querySelector('[data-testid="home-hero"]')?.getAttribute("data-tone")
    expect(tone()).toBe("light")
    act(() => {
      container.querySelector("img")!.dispatchEvent(new Event("error"))
    })
    expect(tone()).toBe("dark")
    const wrapper = container.querySelector("h1")!.parentElement!
    const cta = container.querySelector("a")!
    expect(wrapper.classList.contains("text-charcoal")).toBe(true)
    expect(wrapper.classList.contains("text-ivory")).toBe(false)
    expect(cta.classList.contains("bg-charcoal")).toBe(true)
    expect(cta.classList.contains("bg-ivory")).toBe(false)
  })

  it("renders a 200 character headline", () => {
    const headline = "x".repeat(200)
    const { container } = render(<Hero content={{ headline }} />)
    expect(container.querySelector("h1")?.textContent).toBe(headline)
  })
})
