/**
 * @jest-environment jsdom
 */
import "../../__tests__/text-encoder-polyfill"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import PurchaseDetailPage from "../page"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/purchases/pur_1"]}>
        <Routes>
          <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const basePurchase = {
  id: "pur_1",
  reference: "PO-0001",
  status: "draft",
  currency_code: "usd",
  supplier: { id: "sup_1", name: "Acme Perfumes" },
  items: [
    {
      id: "pitem_1",
      variant_id: "variant_1",
      sku: "OUD-50",
      title: "Midnight Oud 50ml",
      quantity: 10,
      quantity_received: 4,
      remaining: 6,
      unit_cost: 12.5,
    },
    {
      id: "pitem_2",
      variant_id: "variant_2",
      sku: "ROSE-30",
      title: "Rose 30ml",
      quantity: 2,
      quantity_received: 0,
      remaining: 2,
      unit_cost: 7,
    },
  ],
  receipts: [
    {
      id: "rcpt_1",
      stock_location_id: "sloc_1",
      received_at: "2026-10-10T12:00:00.000Z",
      note: "First delivery",
      items: [{ purchase_item_id: "pitem_1", quantity: 4 }],
    },
  ],
  shipping_cost: 5,
  tax: 3.25,
  other_cost: 1.5,
  subtotal: 139,
  total: 148.75,
  notes: null,
  ordered_at: null,
  created_at: "2026-10-01T12:00:00.000Z",
}

function withStatus(status: string) {
  return { ...basePurchase, status }
}

function mockPurchase(purchase: unknown) {
  mockFetch.mockResolvedValue({ purchase })
}

describe("PurchaseDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("shows items with ordered, received and unit cost, the extra costs, subtotal and total", async () => {
    mockPurchase(withStatus("partially_received"))

    renderPage()

    expect(await screen.findByText("PO-0001")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/admin/purchases/pur_1")
    expect(screen.getByText("Acme Perfumes")).toBeInTheDocument()

    const oudRow = screen.getByText("Midnight Oud 50ml").closest("tr")!
    expect(within(oudRow).getByText("OUD-50")).toBeInTheDocument()
    expect(within(oudRow).getByText("10")).toBeInTheDocument()
    expect(within(oudRow).getByText("4")).toBeInTheDocument()
    expect(within(oudRow).getByText("$12.50")).toBeInTheDocument()

    const roseRow = screen.getByText("Rose 30ml").closest("tr")!
    expect(within(roseRow).getByText("$7.00")).toBeInTheDocument()

    expect(screen.getByTestId("shipping-cost")).toHaveTextContent("$5.00")
    expect(screen.getByTestId("tax")).toHaveTextContent("$3.25")
    expect(screen.getByTestId("other-cost")).toHaveTextContent("$1.50")
    expect(screen.getByTestId("subtotal")).toHaveTextContent("$139.00")
    expect(screen.getByTestId("total")).toHaveTextContent("$148.75")
  })

  it("lists each delivery with date, location and quantities", async () => {
    mockPurchase(withStatus("partially_received"))

    renderPage()
    await screen.findByText("PO-0001")

    const delivery = screen.getByTestId("receipt-rcpt_1")
    expect(delivery).toHaveTextContent(
      new Date("2026-10-10T12:00:00.000Z").toLocaleDateString()
    )
    expect(delivery).toHaveTextContent("sloc_1")
    expect(delivery).toHaveTextContent("Midnight Oud 50ml")
    expect(delivery).toHaveTextContent("4")
    expect(delivery).toHaveTextContent("First delivery")
  })

  it("draft shows Place order and Cancel, ordered shows Receive goods and Cancel, partly received shows Receive goods only, received and cancelled show none", async () => {
    const expected: Record<string, string[]> = {
      draft: ["Place order", "Cancel purchase"],
      ordered: ["Receive goods", "Cancel purchase"],
      partially_received: ["Receive goods"],
      received: [],
      cancelled: [],
    }
    const all = ["Place order", "Receive goods", "Cancel purchase"]

    for (const [status, visible] of Object.entries(expected)) {
      mockPurchase(withStatus(status))
      const { unmount } = renderPage()
      await screen.findByText("PO-0001")
      for (const name of all) {
        const button = screen.queryByRole("button", { name })
        if (visible.includes(name)) {
          expect(button).toBeInTheDocument()
        } else {
          expect(button).not.toBeInTheDocument()
        }
      }
      unmount()
    }
  })

  it("Place order and Cancel call their endpoints and refresh", async () => {
    let current: unknown = withStatus("draft")
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/admin/purchases/pur_1/order" && opts?.method === "POST") {
        current = withStatus("ordered")
        return Promise.resolve({ purchase: current })
      }
      if (url === "/admin/purchases/pur_1/cancel" && opts?.method === "POST") {
        current = withStatus("cancelled")
        return Promise.resolve({ purchase: current })
      }
      return Promise.resolve({ purchase: current })
    })

    renderPage()
    await screen.findByText("PO-0001")
    expect(screen.getByTestId("status")).toHaveTextContent("Draft")

    fireEvent.click(screen.getByRole("button", { name: "Place order" }))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/purchases/pur_1/order", {
        method: "POST",
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("Ordered")
    )
    expect(
      screen.queryByRole("button", { name: "Place order" })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Cancel purchase" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel purchase" }))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/purchases/pur_1/cancel", {
        method: "POST",
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("Cancelled")
    )
    expect(
      screen.queryByRole("button", { name: "Cancel purchase" })
    ).not.toBeInTheDocument()
  })

  it("a server error from an action is shown", async () => {
    mockFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.reject(new Error("Purchase has no items"))
      }
      return Promise.resolve({ purchase: withStatus("draft") })
    })

    renderPage()
    await screen.findByText("PO-0001")

    fireEvent.click(screen.getByRole("button", { name: "Place order" }))

    expect(await screen.findByText("Purchase has no items")).toBeInTheDocument()
    expect(screen.getByTestId("status")).toHaveTextContent("Draft")
    expect(screen.getByRole("button", { name: "Place order" })).toBeInTheDocument()
  })

  it("shows an error with Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    mockPurchase(withStatus("draft"))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("PO-0001")).toBeInTheDocument()
  })
})
