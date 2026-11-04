/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const mockFetch = jest.fn()

jest.mock("../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import ReviewsPage from "../page"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewsPage />
    </QueryClientProvider>
  )
}

const pendingReview = {
  id: "rev_1",
  rating: 4,
  title: "Great fragrance",
  comment: "Smells amazing and lasts all day.",
  status: "pending",
  created_at: "2026-10-01T00:00:00.000Z",
  product: { id: "prod_1", title: "Midnight Oud" },
  customer: { id: "cus_1", email: "jane@example.com" },
}

const approvedReview = {
  id: "rev_2",
  rating: 5,
  title: "Loved it",
  comment: "Will buy again.",
  status: "approved",
  created_at: "2026-10-02T00:00:00.000Z",
  product: { id: "prod_2", title: "Ocean Breeze" },
  customer: { id: "cus_2", email: "sam@example.com" },
}

function listResponse(reviews: unknown[], count?: number) {
  return { reviews, count: count ?? reviews.length, offset: 0, limit: 20 }
}

describe("ReviewsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("renders a row per review with product, customer, rating, status", async () => {
    mockFetch.mockResolvedValue(listResponse([pendingReview, approvedReview]))

    renderPage()

    expect(await screen.findByText("Midnight Oud")).toBeInTheDocument()
    expect(screen.getByText("jane@example.com")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("pending")).toBeInTheDocument()

    expect(screen.getByText("Ocean Breeze")).toBeInTheDocument()
    expect(screen.getByText("sam@example.com")).toBeInTheDocument()
    expect(screen.getByText("approved")).toBeInTheDocument()
  })

  it("shows Approve and Reject buttons only for a pending review", async () => {
    mockFetch.mockResolvedValue(listResponse([pendingReview, approvedReview]))

    renderPage()

    await screen.findByText("Midnight Oud")

    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(1)
  })

  it("calls POST /admin/reviews/:id/approve when Approve is clicked", async () => {
    mockFetch.mockResolvedValue(listResponse([pendingReview]))

    renderPage()

    const approveButton = await screen.findByRole("button", { name: "Approve" })
    fireEvent.click(approveButton)

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/reviews/rev_1/approve", {
        method: "POST",
      })
    )
  })

  it("switches the status query param when a different tab is clicked", async () => {
    mockFetch.mockResolvedValue(listResponse([pendingReview], 25))

    renderPage()

    await screen.findByText("Midnight Oud")

    // Initial load defaults to the "Pending" tab.
    expect(mockFetch.mock.calls[0][1].query).toMatchObject({
      status: "pending",
      offset: 0,
    })

    // Page forward before switching tabs, to prove the tab switch resets offset.
    const nextButton = screen.getByRole("button", { name: "Next" })
    fireEvent.click(nextButton)

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[1].query).toMatchObject({ offset: 20 })
    })

    // Radix Tabs triggers switch on mousedown (and on focus, for keyboard
    // nav), not on the synthetic "click" event fireEvent dispatches.
    const approvedTab = screen.getByRole("tab", { name: "Approved" })
    fireEvent.mouseDown(approvedTab)

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[1].query).toMatchObject({ status: "approved", offset: 0 })
    })

    const allTab = screen.getByRole("tab", { name: "All" })
    fireEvent.mouseDown(allTab)

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[1].query).not.toHaveProperty("status")
      expect(lastCall[1].query).toMatchObject({ offset: 0 })
    })
  })

  it("shows an empty state when there are no reviews for the selected tab", async () => {
    mockFetch.mockResolvedValue(listResponse([], 0))

    renderPage()

    expect(await screen.findByText("No pending reviews.")).toBeInTheDocument()
  })

  it("shows an inline error with a Retry button when the request fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()

    mockFetch.mockResolvedValue(listResponse([pendingReview]))
    const retryButton = screen.getByRole("button", { name: "Retry" })
    fireEvent.click(retryButton)

    expect(await screen.findByText("Midnight Oud")).toBeInTheDocument()
  })

  // Task 4c: the empty-state copy names the tab instead of using one
  // generic string for every filter.
  it("uses tab-specific empty-state copy for pending, approved, and rejected", async () => {
    mockFetch.mockResolvedValue(listResponse([], 0))
    renderPage()

    expect(await screen.findByText("No pending reviews.")).toBeInTheDocument()

    const approvedTab = screen.getByRole("tab", { name: "Approved" })
    fireEvent.mouseDown(approvedTab)
    expect(await screen.findByText("No approved reviews.")).toBeInTheDocument()

    const rejectedTab = screen.getByRole("tab", { name: "Rejected" })
    fireEvent.mouseDown(rejectedTab)
    expect(await screen.findByText("No rejected reviews.")).toBeInTheDocument()

    const allTab = screen.getByRole("tab", { name: "All" })
    fireEvent.mouseDown(allTab)
    expect(await screen.findByText("No reviews found.")).toBeInTheDocument()
  })

  // Task 4d: a long comment must be truncated in the table but keep the
  // full text available via a `title` attribute, instead of rendering the
  // full, unbounded text and breaking the table layout.
  it("truncates a long comment and exposes the full text via a title attribute", async () => {
    const longComment =
      "This fragrance is absolutely incredible and lasted the entire day " +
      "through a long shift, several meetings, and a workout, and I would " +
      "recommend it to anyone who loves a warm, woody scent that doesn't fade."
    mockFetch.mockResolvedValue(
      listResponse([{ ...pendingReview, comment: longComment }])
    )

    renderPage()

    const commentNode = await screen.findByTitle(longComment)
    expect(commentNode).toBeInTheDocument()
    expect(commentNode.textContent).not.toBe(longComment)
    expect(commentNode.textContent!.length).toBeLessThan(longComment.length)
  })

  // Task 4d: Reject should use the UI library's danger variant, not the
  // default button styling.
  it("renders the Reject button with the danger variant", async () => {
    mockFetch.mockResolvedValue(listResponse([pendingReview]))

    renderPage()

    const rejectButton = await screen.findByRole("button", { name: "Reject" })
    expect(rejectButton.className).toMatch(/danger/)
  })

  // Task 4b: a failed mutation (e.g. the review was already deleted by the
  // customer, a 404) must surface feedback instead of failing silently.
  it("shows an inline error when Approve fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/approve")) {
        return Promise.reject(new Error("Review not found"))
      }
      return Promise.resolve(listResponse([pendingReview]))
    })

    renderPage()

    const approveButton = await screen.findByRole("button", { name: "Approve" })
    fireEvent.click(approveButton)

    expect(await screen.findByText("Review not found")).toBeInTheDocument()
  })

  // Task 4b: disable both buttons on a row while either of its mutations is
  // in flight, so a fast double-click or an Approve-then-Reject race can't
  // leave a non-deterministic final state.
  it("disables Approve and Reject on a row while a mutation for that row is in flight", async () => {
    let resolveApprove: (() => void) | undefined
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/approve")) {
        return new Promise<void>((resolve) => {
          resolveApprove = resolve
        })
      }
      return Promise.resolve(listResponse([pendingReview]))
    })

    renderPage()

    const approveButton = await screen.findByRole("button", { name: "Approve" })
    const rejectButton = screen.getByRole("button", { name: "Reject" })
    fireEvent.click(approveButton)

    await waitFor(() => expect(approveButton).toBeDisabled())
    expect(rejectButton).toBeDisabled()

    resolveApprove?.()
  })

  // Task 4a: approving/rejecting the last review(s) on page 2+ must not
  // strand the moderator -- Previous stays available even though the
  // now-current page has no rows.
  it("keeps the Previous button available on an empty page beyond the first", async () => {
    mockFetch.mockResolvedValue(listResponse([pendingReview], 25))
    renderPage()

    const nextButton = await screen.findByRole("button", { name: "Next" })
    fireEvent.click(nextButton)

    mockFetch.mockResolvedValue(listResponse([], 25))

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall[1].query).toMatchObject({ offset: 20 })
    })

    const previousButton = await screen.findByRole("button", {
      name: "Previous",
    })
    expect(previousButton).toBeEnabled()
  })
})
