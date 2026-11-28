// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

vi.mock("next/navigation", () => ({ usePathname: () => "/us/store" }))
vi.mock("@modules/products/components/thumbnail", () => ({
  default: ({ sizes }: { sizes?: string }) => (
    <div data-testid="thumb" data-sizes={sizes} />
  ),
}))
vi.mock("@modules/common/components/delete-button", () => ({
  default: () => null,
}))
vi.mock("@modules/common/components/line-item-options", () => ({
  default: () => null,
}))
vi.mock("@modules/common/components/line-item-price", () => ({
  default: () => null,
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import CartDropdown from "./index"

afterEach(cleanup)

describe("CartDropdown thumbnail", () => {
  it("passes an explicit 96px sizes for its w-24 slot", () => {
    const cart = {
      id: "c",
      subtotal: 10,
      currency_code: "usd",
      items: [
        {
          id: "i",
          title: "T",
          product_handle: "t",
          thumbnail: "/t.jpg",
          quantity: 1,
          created_at: new Date().toISOString(),
        },
      ],
    }
    const { container } = render(<CartDropdown cart={cart as never} />)
    act(() => {
      container.firstElementChild?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true })
      )
    })
    expect(
      document.querySelector('[data-testid="thumb"]')?.getAttribute("data-sizes")
    ).toBe("96px")
  })
})
