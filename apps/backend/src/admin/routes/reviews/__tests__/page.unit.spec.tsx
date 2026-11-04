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

    expect(await screen.findByText(/no reviews/i)).toBeInTheDocument()
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
})
