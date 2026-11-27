// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, userEvent } from "../../../../test/render"
import ViewToggle from "./index"

vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

const byLabel = (label: string) =>
  document.querySelector(`[aria-label="${label}"]`) as HTMLElement

describe("ViewToggle", () => {
  it("renders buttons with aria-pressed and calls onChange", async () => {
    const onChange = vi.fn()
    render(<ViewToggle view="grid" onChange={onChange} />)

    expect(byLabel("Grid view").getAttribute("aria-pressed")).toBe("true")
    expect(byLabel("List view").getAttribute("aria-pressed")).toBe("false")

    await userEvent.click(byLabel("List view"))
    expect(onChange).toHaveBeenCalledWith("list")
  })

  it("renders links with aria-current when hrefFor is given", () => {
    render(<ViewToggle view="list" hrefFor={(v) => `/store?view=${v}`} />)

    const list = byLabel("List view")
    expect(list.tagName).toBe("A")
    expect(list.getAttribute("aria-current")).toBe("true")
    expect(byLabel("Grid view").getAttribute("href")).toBe("/store?view=grid")
    expect(byLabel("Grid view").getAttribute("aria-current")).toBeNull()
  })
})
