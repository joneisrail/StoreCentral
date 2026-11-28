// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../../test/render"

vi.mock("@modules/products/components/thumbnail", () => ({
  default: ({ sizes }: { sizes?: string }) => (
    <div data-testid="thumb" data-sizes={sizes} />
  ),
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import OrderCard from "./index"

afterEach(cleanup)

describe("OrderCard thumbnail", () => {
  it("passes an explicit grid-matching sizes", () => {
    const order = {
      id: "o",
      display_id: 1,
      created_at: new Date().toISOString(),
      currency_code: "usd",
      total: 100,
      items: [{ id: "a", title: "A", thumbnail: "/a.jpg", quantity: 1 }],
    }
    const { container } = render(<OrderCard order={order as never} />)
    expect(
      container.querySelector('[data-testid="thumb"]')?.getAttribute("data-sizes")
    ).toBe("(min-width: 1024px) 25vw, 50vw")
  })
})
