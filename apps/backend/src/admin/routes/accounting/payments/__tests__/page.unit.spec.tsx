/**
 * @jest-environment jsdom
 */
import "../../../purchases/__tests__/text-encoder-polyfill"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
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

import PaymentsPage, { config } from "../page"

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/payments"]}>
        <Routes>
          <Route path="/accounting/payments" element={<PaymentsPage />} />
          <Route
            path="/accounting/invoices/:id"
            element={<div>Detail page</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type Payment = {
  id: string
  reference: string
  invoice: { id: string; reference: string; invoice_number: string } | null
  supplier: { id: string; name: string } | null
  amount: number
  paid_at: string
  method: string
  payment_reference: string | null
  note: string | null
  status: string
  voided_at: string | null
  created_at: string
}

function makePayment(n: number, overrides: Partial<Payment> = {}): Payment {
  return {
    id: `pay_${n}`,
    reference: `PAY-${String(n).padStart(4, "0")}`,
    invoice: { id: `inv_${n}`, reference: `INV-${n}`, invoice_number: `SUP-${n}` },
    supplier: { id: "sup_1", name: "Acme Perfumes" },
    amount: 10,
    paid_at: "2026-10-05",
    method: "bank_transfer",
    payment_reference: `REF-${n}`,
    note: null,
    status: "recorded",
    voided_at: null,
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  }
}

// Stateful mock server: filters, searches and paginates the current data and
// returns a fresh response object on every call.
let serverPayments: Payment[] = []

function installServer() {
  mockFetch.mockImplementation(
    (url: string, opts?: { query?: Record<string, unknown> }) => {
      if (url !== "/admin/supplier-payments") {
        return Promise.reject(new Error(`unexpected fetch ${url}`))
      }
      const query = opts?.query ?? {}
      const offset = Number(query.offset ?? 0)
      const limit = Number(query.limit ?? 20)
      let rows = serverPayments
      if (query.status) {
        rows = rows.filter((p) => p.status === query.status)
      }
      if (query.method) {
        rows = rows.filter((p) => p.method === query.method)
      }
      if (query.q) {
        rows = rows.filter((p) =>
          (p.payment_reference ?? "").includes(String(query.q))
        )
      }
      return Promise.resolve({
        payments: rows.slice(offset, offset + limit).map((p) => ({ ...p })),
        count: rows.length,
        offset,
        limit,
      })
    }
  )
}

function listCalls() {
  return mockFetch.mock.calls.filter(
    (c) => c[0] === "/admin/supplier-payments" && c[1]?.query
  )
}

function lastQuery() {
  const calls = listCalls()
  return calls[calls.length - 1][1].query
}

function manyPayments(count: number) {
  return Array.from({ length: count }, (_, i) => makePayment(i + 1))
}

async function flush() {
  await act(async () => {})
}

describe("PaymentsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverPayments = []
    installServer()
  })

  it("shows reference, date, supplier, invoice, method, amount and status", async () => {
    serverPayments = [
      makePayment(1, { amount: 1234.5, method: "cheque" }),
      makePayment(2, {
        supplier: null,
        invoice: null,
        status: "void",
        amount: 12.5,
        method: "cash",
      }),
    ]

    renderPage()

    expect(await screen.findByText("PAY-0001")).toBeInTheDocument()
    expect(screen.getByText("Acme Perfumes")).toBeInTheDocument()
    expect(
      screen.getAllByText(
        new Date("2026-10-05").toLocaleDateString(undefined, {
          timeZone: "UTC",
        })
      )
    ).toHaveLength(2)
    expect(screen.getByText("$1,234.50")).toBeInTheDocument()
    expect(screen.getByText("$12.50")).toBeInTheDocument()
    const rows = screen.getAllByRole("row")
    expect(rows[1]).toHaveTextContent("Cheque")
    expect(rows[1]).toHaveTextContent("Recorded")
    expect(rows[2]).toHaveTextContent("Cash")
    expect(rows[2]).toHaveTextContent("Void")
    // Missing supplier and invoice render a dash.
    expect(rows[2]).toHaveTextContent("—")
    expect(mockFetch).toHaveBeenCalledWith("/admin/supplier-payments", {
      query: { limit: 20, offset: 0 },
    })
  })

  it("labels every known method", async () => {
    serverPayments = [
      makePayment(1, { method: "bank_transfer" }),
      makePayment(2, { method: "cash" }),
      makePayment(3, { method: "card" }),
      makePayment(4, { method: "cheque" }),
      makePayment(5, { method: "other" }),
    ]

    renderPage()
    await screen.findByText("PAY-0001")

    const rows = screen.getAllByRole("row")
    expect(rows[1]).toHaveTextContent("Bank transfer")
    expect(rows[2]).toHaveTextContent("Cash")
    expect(rows[3]).toHaveTextContent("Card")
    expect(rows[4]).toHaveTextContent("Cheque")
    expect(rows[5]).toHaveTextContent("Other")
  })

  it("falls back to the raw text for unknown method and status", async () => {
    serverPayments = [
      makePayment(1, { method: "crypto_wire", status: "pending_review" }),
    ]

    renderPage()
    await screen.findByText("PAY-0001")

    expect(screen.getByText("crypto_wire")).toBeInTheDocument()
    expect(screen.getByText("pending_review")).toBeInTheDocument()
  })

  it("links the invoice reference and number to the invoice detail", async () => {
    serverPayments = [makePayment(1)]

    renderPage()

    const link = await screen.findByRole("link", { name: /INV-1/ })
    expect(link).toHaveTextContent("INV-1 (SUP-1)")
    expect(link).toHaveAttribute("href", "/accounting/invoices/inv_1")
    fireEvent.click(link)
    expect(await screen.findByText("Detail page")).toBeInTheDocument()
  })

  it("status filter sends status and resets the offset to 0", async () => {
    serverPayments = manyPayments(45).map((p, idx) =>
      idx % 2 === 0 ? { ...p, status: "void" } : p
    )

    renderPage()
    await screen.findByText("PAY-0001")

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")
    expect(lastQuery()).toEqual({ limit: 20, offset: 20 })

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Void" }))
    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 20, offset: 0, status: "void" })
    )
    expect(await screen.findByText("PAY-0001")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole("tab", { name: "All" }))
    await waitFor(() => expect(lastQuery()).toEqual({ limit: 20, offset: 0 }))
  })

  it("method filter sends method and resets the offset to 0", async () => {
    serverPayments = manyPayments(45).map((p, idx) =>
      idx % 2 === 0 ? { ...p, method: "cash" } : p
    )

    renderPage()
    await screen.findByText("PAY-0001")

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")
    expect(lastQuery()).toEqual({ limit: 20, offset: 20 })

    fireEvent.change(screen.getByLabelText("Filter by method"), {
      target: { value: "cash" },
    })
    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 20, offset: 0, method: "cash" })
    )
    expect(await screen.findByText("PAY-0001")).toBeInTheDocument()
    // The filtered request never went out with the stale page-2 offset.
    expect(
      listCalls().filter((c) => c[1].query.method && c[1].query.offset !== 0)
    ).toEqual([])

    fireEvent.change(screen.getByLabelText("Filter by method"), {
      target: { value: "all" },
    })
    await waitFor(() => expect(lastQuery()).toEqual({ limit: 20, offset: 0 }))
  })

  it("search sends q after a short debounce and resets the offset", async () => {
    serverPayments = manyPayments(45)

    renderPage()
    await screen.findByText("PAY-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")

    fireEvent.change(screen.getByLabelText("Search payments"), {
      target: { value: "REF-3" },
    })
    // Not searched yet: the debounce has not elapsed.
    await flush()
    expect(listCalls().some((c) => c[1].query.q)).toBe(false)

    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "REF-3" })
    )
    expect(await screen.findByText("PAY-0003")).toBeInTheDocument()
    expect(
      listCalls().filter((c) => c[1].query.q && c[1].query.offset !== 0)
    ).toEqual([])
  })

  it("pressing Enter searches immediately", async () => {
    serverPayments = manyPayments(45)

    renderPage()
    await screen.findByText("PAY-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")

    const input = screen.getByLabelText("Search payments")
    fireEvent.change(input, { target: { value: "REF-4" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(
      () => expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "REF-4" }),
      { timeout: 150 }
    )
  })

  it("paginates with Next and Previous from count and offset", async () => {
    serverPayments = manyPayments(45)

    renderPage()
    await screen.findByText("PAY-0001")

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")
    expect(lastQuery().offset).toBe(20)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0041")
    expect(lastQuery().offset).toBe(40)
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    await screen.findByText("PAY-0021")
    expect(lastQuery().offset).toBe(20)
  })

  it("clamps to the last valid page when the count shrinks", async () => {
    serverPayments = manyPayments(45)

    renderPage()
    await screen.findByText("PAY-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0041")

    serverPayments = manyPayments(25)
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "supplier-payments"],
      })
    })

    await waitFor(() => expect(lastQuery().offset).toBe(20))
    expect(await screen.findByText("PAY-0025")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("clamps back to the first page when the count drops to zero", async () => {
    serverPayments = manyPayments(25)

    renderPage()
    await screen.findByText("PAY-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("PAY-0021")

    serverPayments = []
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "supplier-payments"],
      })
    })

    await waitFor(() => expect(lastQuery().offset).toBe(0))
    expect(await screen.findByText("No payments yet.")).toBeInTheDocument()
  })

  it("does not refetch when nothing changed (no reset loops)", async () => {
    serverPayments = manyPayments(25)

    renderPage()
    await screen.findByText("PAY-0001")
    await flush()
    const before = listCalls().length
    await flush()
    expect(listCalls().length).toBe(before)
  })

  it("shows empty text, and a filtered variant when filters are active", async () => {
    renderPage()
    expect(await screen.findByText("No payments yet.")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Void" }))
    expect(
      await screen.findByText("No payments match your filters.")
    ).toBeInTheDocument()
  })

  it("shows an error with a working Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    serverPayments = [makePayment(1)]
    installServer()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("PAY-0001")).toBeInTheDocument()
  })
})

describe("route config", () => {
  it("labels the page Payments with no nested override", () => {
    expect(config.label).toBe("Payments")
    expect((config as { nested?: string }).nested).toBeUndefined()
  })
})
