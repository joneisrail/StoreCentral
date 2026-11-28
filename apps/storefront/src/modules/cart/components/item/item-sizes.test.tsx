// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../../test/render"

vi.mock("@modules/products/components/thumbnail", () => ({
  default: ({ sizes }: { sizes?: string }) => (
    <div data-testid="thumb" data-sizes={sizes} />
  ),
}))
vi.mock("@lib/data/cart", () => ({ updateLineItem: vi.fn() }))
vi.mock("@modules/cart/components/cart-item-select", () => ({
  default: () => null,
}))
vi.mock("@modules/checkout/components/error-message", () => ({
  default: () => null,
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
vi.mock("@modules/common/components/line-item-unit-price", () => ({
  default: () => null,
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import Item from "./index"

afterEach(cleanup)

describe("cart Item thumbnail", () => {
  it("passes an explicit 96px sizes", () => {
    const { container } = render(
      <table>
        <tbody>
          <Item
            item={{ id: "i", title: "T", thumbnail: "/t.jpg", quantity: 1 } as never}
            currencyCode="usd"
          />
        </tbody>
      </table>
    )
    expect(
      container.querySelector('[data-testid="thumb"]')?.getAttribute("data-sizes")
    ).toBe("96px")
  })
})
