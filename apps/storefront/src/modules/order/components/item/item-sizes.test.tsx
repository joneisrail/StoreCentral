// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../../test/render"

vi.mock("@modules/products/components/thumbnail", () => ({
  default: ({ sizes }: { sizes?: string }) => (
    <div data-testid="thumb" data-sizes={sizes} />
  ),
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

import Item from "./index"

afterEach(cleanup)

describe("order Item thumbnail", () => {
  it("passes an explicit 64px sizes for its w-16 slot", () => {
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
    ).toBe("64px")
  })
})
