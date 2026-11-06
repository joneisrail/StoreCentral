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

let invoicesResponse: unknown = { invoices: [], count: 0 }
let invoicesError: Error | null = null

function invoicesResult() {
  return invoicesError
    ? Promise.reject(invoicesError)
    : Promise.resolve(JSON.parse(JSON.stringify(invoicesResponse)))
}

function mockPurchase(purchase: unknown) {
  mockFetch.mockImplementation((url: string) =>
    url === "/admin/invoices"
      ? invoicesResult()
      : Promise.resolve({ purchase })
  )
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    reference: "INV-0001",
    status: "draft",
    invoice_number: "SUP-77",
    total: 73.75,
    ...overrides,
  }
}

describe("PurchaseDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    invoicesResponse = { invoices: [], count: 0 }
    invoicesError = null
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
      if (url === "/admin/invoices") {
        return invoicesResult()
      }
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
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/admin/invoices") {
        return invoicesResult()
      }
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

    expect(
      await screen.findByText(/something went wrong loading this purchase/i)
    ).toBeInTheDocument()
    mockPurchase(withStatus("draft"))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("PO-0001")).toBeInTheDocument()
  })

  it("links Record invoice to the new invoice page for this purchase", async () => {
    mockPurchase(withStatus("ordered"))

    renderPage()
    await screen.findByText("PO-0001")

    expect(screen.getByRole("link", { name: "Record invoice" })).toHaveAttribute(
      "href",
      "/accounting/invoices/new?purchase_id=pur_1"
    )
  })

  it("shows Record invoice only for ordered, partly received and received purchases", async () => {
    const expected: Record<string, boolean> = {
      draft: false,
      ordered: true,
      partially_received: true,
      received: true,
      cancelled: false,
    }
    for (const [status, shown] of Object.entries(expected)) {
      mockPurchase(withStatus(status))
      const { unmount } = renderPage()
      await screen.findByText("PO-0001")
      const link = screen.queryByRole("link", { name: "Record invoice" })
      if (shown) {
        expect(link).toBeInTheDocument()
      } else {
        expect(link).not.toBeInTheDocument()
      }
      unmount()
    }
  })

  it("lists the purchase's invoices with reference, number, total and status", async () => {
    invoicesResponse = {
      invoices: [
        makeInvoice(),
        makeInvoice({
          id: "inv_2",
          reference: "INV-0002",
          invoice_number: "SUP-78",
          total: 10,
          status: "posted",
        }),
        makeInvoice({ id: "inv_3", reference: "INV-0003", status: "weird" }),
      ],
      count: 3,
    }
    mockPurchase(withStatus("ordered"))

    renderPage()

    const first = (await screen.findByText("INV-0001")).closest("tr")!
    expect(mockFetch).toHaveBeenCalledWith("/admin/invoices", {
      query: { purchase_id: "pur_1", limit: 100 },
    })
    expect(screen.getByRole("link", { name: "INV-0001" })).toHaveAttribute(
      "href",
      "/accounting/invoices/inv_1"
    )
    expect(within(first).getByText("SUP-77")).toBeInTheDocument()
    expect(within(first).getByText("$73.75")).toBeInTheDocument()
    expect(within(first).getByText("Draft")).toBeInTheDocument()

    const second = screen.getByText("INV-0002").closest("tr")!
    expect(within(second).getByText("SUP-78")).toBeInTheDocument()
    expect(within(second).getByText("$10.00")).toBeInTheDocument()
    expect(within(second).getByText("Posted")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "INV-0002" })).toHaveAttribute(
      "href",
      "/accounting/invoices/inv_2"
    )

    // An unknown status shows the raw text, not an empty badge.
    const third = screen.getByText("INV-0003").closest("tr")!
    expect(within(third).getByText("weird")).toBeInTheDocument()
  })

  it("shows an empty message when the purchase has no invoices", async () => {
    mockPurchase(withStatus("ordered"))

    renderPage()

    expect(await screen.findByText("No invoices yet.")).toBeInTheDocument()
  })

  it("shows an invoices error with Retry without breaking the rest of the page", async () => {
    invoicesError = new Error("boom")
    mockPurchase(withStatus("ordered"))

    renderPage()

    expect(
      await screen.findByText(/something went wrong loading the invoices/i)
    ).toBeInTheDocument()
    expect(screen.getByText("PO-0001")).toBeInTheDocument()
    expect(screen.getByText("Midnight Oud 50ml")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Receive goods" })).toBeInTheDocument()

    invoicesError = null
    invoicesResponse = { invoices: [makeInvoice()], count: 1 }
    fireEvent.click(screen.getByRole("button", { name: "Retry invoices" }))
    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
    expect(
      screen.queryByText(/something went wrong loading the invoices/i)
    ).not.toBeInTheDocument()
  })
})
