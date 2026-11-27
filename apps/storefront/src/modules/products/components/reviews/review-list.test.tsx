// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import ReviewList from "./review-list"
import type { ReviewsPage } from "@lib/data/reviews"

const loadMore = vi.fn()
vi.mock("@lib/data/review-actions", () => ({
  loadMore: (...args: unknown[]) => loadMore(...args),
}))

const review = (n: number) => ({
  id: `rev_${n}`,
  rating: 4,
  title: `Title ${n}`,
  comment: `Comment ${n}`,
  created_at: "2026-01-02T00:00:00.000Z",
  author: `Author ${n}`,
})

const page = (ns: number[], count: number): ReviewsPage => ({
  reviews: ns.map(review),
  count,
  average: 4,
})

const btn = () =>
  Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Load more")
  )

beforeEach(() => loadMore.mockReset())
afterEach(cleanup)

describe("ReviewList", () => {
  it("renders author, title and comment", () => {
    const { container } = render(
      <ReviewList productId="p1" initial={page([1], 1)} />
    )
    expect(container.textContent).toContain("Author 1")
    expect(container.textContent).toContain("Title 1")
    expect(container.textContent).toContain("Comment 1")
  })

  it("hides Load more when everything is loaded", () => {
    render(<ReviewList productId="p1" initial={page([1, 2], 2)} />)
    expect(btn()).toBeUndefined()
  })

  it("loads the next page and appends", async () => {
    loadMore.mockResolvedValue({ ok: true, page: page([3], 3) })
    const { container } = render(
      <ReviewList productId="p1" initial={page([1, 2], 3)} />
    )
    await act(async () => {
      await userEvent.click(btn()!)
    })
    expect(loadMore).toHaveBeenCalledWith("p1", 2)
    expect(container.textContent).toContain("Title 1")
    expect(container.textContent).toContain("Title 3")
    expect(btn()).toBeUndefined()
  })

  it("shows an inline error and keeps the button on failure", async () => {
    loadMore.mockResolvedValue({ ok: false })
    const { container } = render(
      <ReviewList productId="p1" initial={page([1], 3)} />
    )
    await act(async () => {
      await userEvent.click(btn()!)
    })
    expect(container.textContent).toContain("Couldn't load more reviews")
    expect(btn()).toBeDefined()
  })
})
