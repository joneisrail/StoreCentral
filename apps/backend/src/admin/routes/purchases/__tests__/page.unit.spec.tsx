/**
 * @jest-environment jsdom
 */
import "./text-encoder-polyfill"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import PurchasesPage from "../page"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/purchases"]}>
        <Routes>
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/purchases/new" element={<div>New purchase page</div>} />
          <Route path="/purchases/:id" element={<div>Detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const purchase = {
  id: "pur_1",
  reference: "PO-0001",
  status: "ordered",
  currency_code: "usd",
  supplier: { id: "sup_1", name: "Acme Perfumes" },
  items: [],
  receipts: [],
  shipping_cost: 0,
  tax: 0,
  other_cost: 0,
  subtotal: 100,
  total: 1234.5,
  notes: null,
  ordered_at: "2026-10-05T12:00:00.000Z",
  created_at: "2026-10-01T12:00:00.000Z",
}

const draftNoSupplier = {
  ...purchase,
  id: "pur_2",
  reference: "PO-0002",
  status: "draft",
  supplier: null,
  total: 12.5,
  ordered_at: null,
}

function listResponse(purchases: unknown[], count?: number) {
  return { purchases, count: count ?? purchases.length, offset: 0, limit: 20 }
}

function lastListCall() {
  const calls = mockFetch.mock.calls.filter(
    (c) => c[0] === "/admin/purchases" && c[1]?.query
  )
  return calls[calls.length - 1]
}

describe("PurchasesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("shows reference, supplier, status, total and order date", async () => {
    mockFetch.mockResolvedValue(listResponse([purchase, draftNoSupplier]))

    renderPage()

    expect(await screen.findByText("PO-0001")).toBeInTheDocument()
    expect(screen.getByText("Acme Perfumes")).toBeInTheDocument()
    expect(screen.getByText("$1,234.50")).toBeInTheDocument()
    expect(
      screen.getByText(new Date(purchase.ordered_at).toLocaleDateString())
    ).toBeInTheDocument()
    expect(screen.getByText("PO-0002")).toBeInTheDocument()
    expect(screen.getByText("$12.50")).toBeInTheDocument()
    // The tab triggers share the status labels, so check the table rows.
    const rows = screen.getAllByRole("row")
    expect(rows[1]).toHaveTextContent("Ordered")
    expect(rows[2]).toHaveTextContent("Draft")
    expect(mockFetch).toHaveBeenCalledWith("/admin/purchases", {
      query: { limit: 20, offset: 0 },
    })
  })

  it("status tabs (All, Draft, Ordered, Partly received, Received, Cancelled) refetch with the status filter", async () => {
    mockFetch.mockResolvedValue(listResponse([purchase]))

    renderPage()
    await screen.findByText("PO-0001")

    for (const name of [
      "All",
      "Draft",
      "Ordered",
      "Partly received",
      "Received",
      "Cancelled",
    ]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument()
    }

    const expectations: [string, string][] = [
      ["Draft", "draft"],
      ["Ordered", "ordered"],
      ["Partly received", "partially_received"],
      ["Received", "received"],
      ["Cancelled", "cancelled"],
    ]
    for (const [name, status] of expectations) {
      fireEvent.mouseDown(screen.getByRole("tab", { name }))
      await waitFor(() =>
        expect(lastListCall()[1].query).toEqual({ limit: 20, offset: 0, status })
      )
    }

    fireEvent.mouseDown(screen.getByRole("tab", { name: "All" }))
    await waitFor(() =>
      expect(lastListCall()[1].query).toEqual({ limit: 20, offset: 0 })
    )
  })

  it("per-tab empty text", async () => {
    mockFetch.mockResolvedValue(listResponse([], 0))

    renderPage()
    expect(await screen.findByText("No purchases yet.")).toBeInTheDocument()

    const expectations: [string, string][] = [
      ["Draft", "No draft purchases."],
      ["Ordered", "No ordered purchases."],
      ["Partly received", "No partly received purchases."],
      ["Received", "No received purchases."],
      ["Cancelled", "No cancelled purchases."],
    ]
    for (const [name, text] of expectations) {
      fireEvent.mouseDown(screen.getByRole("tab", { name }))
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
  })

  it('a "New purchase" button links to /purchases/new', async () => {
    mockFetch.mockResolvedValue(listResponse([purchase]))

    renderPage()
    await screen.findByText("PO-0001")

    const link = screen.getByRole("link", { name: "New purchase" })
    expect(link).toHaveAttribute("href", "/purchases/new")
    fireEvent.click(link)
    expect(await screen.findByText("New purchase page")).toBeInTheDocument()
  })

  it("row click opens /purchases/:id", async () => {
    mockFetch.mockResolvedValue(listResponse([purchase]))

    renderPage()
    fireEvent.click(await screen.findByText("PO-0001"))

    expect(await screen.findByText("Detail page")).toBeInTheDocument()
  })

  it("shows an error with Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    mockFetch.mockResolvedValue(listResponse([purchase]))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("PO-0001")).toBeInTheDocument()
  })
})
