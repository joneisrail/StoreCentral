// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../test/render"

import Editorial from "./editorial"
import Newsletter from "./newsletter"
import PromoBanners from "./promo-banners"

afterEach(cleanup)

describe("PromoBanners", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<PromoBanners promos={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders one promo", () => {
    const { container } = render(
      <PromoBanners
        promos={[{ id: "p", title: "Sale", href: "/store", ctaLabel: "Shop" }]}
      />
    )
    expect(container.textContent).toContain("Sale")
    expect(container.querySelectorAll("a")).toHaveLength(1)
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/store")
  })
})

describe("Editorial", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<Editorial blocks={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders one block", () => {
    const { container } = render(
      <Editorial blocks={[{ id: "e", title: "Story", text: "Body copy" }]} />
    )
    expect(container.textContent).toContain("Story")
    expect(container.textContent).toContain("Body copy")
  })
})

describe("Newsletter", () => {
  it("renders nothing without an action", () => {
    const { container } = render(<Newsletter action={null} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders a labelled post form", () => {
    const { container } = render(<Newsletter action="https://x.test/f" />)
    const form = container.querySelector("form")
    expect(form?.getAttribute("method")).toBe("post")
    expect(form?.getAttribute("action")).toBe("https://x.test/f")
    const input = container.querySelector('input[name="email"]')
    expect(input?.getAttribute("type")).toBe("email")
    expect(input?.hasAttribute("required")).toBe(true)
    expect(input?.id).toBeTruthy()
    const label = container.querySelector(`label[for="${input?.id}"]`)
    expect(label?.textContent).toBeTruthy()
    expect(container.querySelector('button[type="submit"]')).not.toBeNull()
  })
})
