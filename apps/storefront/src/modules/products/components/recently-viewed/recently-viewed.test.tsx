// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

const waitFor = async (check: () => void) => {
  let last: unknown
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    try {
      check()
      return
    } catch (e) {
      last = e
    }
  }
  throw last
}

const listProductsByIds = vi.fn()
vi.mock("@lib/data/recent-products", () => ({
  listProductsByIds: (...args: unknown[]) => listProductsByIds(...args),
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import RecentlyViewed from "./index"

const prod = (id: string) => ({
  id,
  title: `Title ${id}`,
  handle: id,
  variants: [],
})

beforeEach(() => {
  window.localStorage.clear()
  listProductsByIds.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("RecentlyViewed", () => {
  it("records the current id and lists the others", async () => {
    window.localStorage.setItem("sc-recently-viewed", JSON.stringify(["b", "c"]))
    listProductsByIds.mockResolvedValue([prod("b"), prod("c")])
    const { container } = render(
      <RecentlyViewed productId="a" countryCode="us" />
    )
    await waitFor(() =>
      expect(container.textContent).toContain("Title b")
    )
    expect(listProductsByIds).toHaveBeenCalledWith(["b", "c"], "us")
    expect(
      JSON.parse(window.localStorage.getItem("sc-recently-viewed") ?? "[]")
    ).toEqual(["a", "b", "c"])
  })

  it("hides the current product from the list", async () => {
    listProductsByIds.mockResolvedValue([prod("a"), prod("b")])
    window.localStorage.setItem("sc-recently-viewed", JSON.stringify(["b"]))
    const { container } = render(
      <RecentlyViewed productId="a" countryCode="us" />
    )
    await waitFor(() => expect(container.textContent).toContain("Title b"))
    expect(container.textContent).not.toContain("Title a")
  })

  it("renders nothing when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    const { container } = render(
      <RecentlyViewed productId="a" countryCode="us" />
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(container.innerHTML).toBe("")
    expect(listProductsByIds).not.toHaveBeenCalled()
  })

  it("renders nothing when the list is empty", async () => {
    listProductsByIds.mockResolvedValue([])
    window.localStorage.setItem("sc-recently-viewed", JSON.stringify(["b"]))
    const { container } = render(
      <RecentlyViewed productId="a" countryCode="us" />
    )
    await waitFor(() => expect(listProductsByIds).toHaveBeenCalled())
    expect(container.innerHTML).toBe("")
  })
})
