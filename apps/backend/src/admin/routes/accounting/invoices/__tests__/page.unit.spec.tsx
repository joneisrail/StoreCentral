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

import InvoicesPage, { config as invoicesConfig } from "../page"
import AccountingPage, { config as accountingConfig } from "../../page"

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/invoices"]}>
        <Routes>
          <Route path="/accounting/invoices" element={<InvoicesPage />} />
          <Route
            path="/accounting/invoices/new"
            element={<div>New invoice page</div>}
          />
          <Route
            path="/accounting/invoices/:id"
            element={<div>Detail page</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type Invoice = {
  id: string
  reference: string
  status: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  supplier: { id: string; name: string } | null
  purchase: { id: string; reference: string } | null
  items: unknown[]
  total: number
  [key: string]: unknown
}

function makeInvoice(n: number, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: `inv_${n}`,
    reference: `INV-${String(n).padStart(4, "0")}`,
    status: "draft",
    invoice_number: `SUP-${n}`,
    invoice_date: "2026-10-05",
    due_date: null,
    supplier: { id: "sup_1", name: "Acme Perfumes" },
    purchase: { id: "pur_1", reference: "PO-0001" },
    items: [],
    shipping_cost: 0,
    tax: 0,
    other_cost: 0,
    subtotal: 0,
    total: 10,
    notes: null,
    posted_at: null,
    voided_at: null,
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  }
}

// Stateful mock server: filters, searches and paginates the current data and
// returns a fresh response object on every call.
let serverInvoices: Invoice[] = []

function installServer() {
  mockFetch.mockImplementation(
    (url: string, opts?: { query?: Record<string, unknown> }) => {
      if (url !== "/admin/invoices") {
        return Promise.reject(new Error(`unexpected fetch ${url}`))
      }
      const query = opts?.query ?? {}
      const offset = Number(query.offset ?? 0)
      const limit = Number(query.limit ?? 20)
      let rows = serverInvoices
      if (query.status) {
        rows = rows.filter((i) => i.status === query.status)
      }
      if (query.q) {
        rows = rows.filter((i) => i.invoice_number.includes(String(query.q)))
      }
      return Promise.resolve({
        invoices: rows.slice(offset, offset + limit).map((i) => ({ ...i })),
        count: rows.length,
        offset,
        limit,
      })
    }
  )
}

function listCalls() {
  return mockFetch.mock.calls.filter(
    (c) => c[0] === "/admin/invoices" && c[1]?.query
  )
}

function lastQuery() {
  const calls = listCalls()
  return calls[calls.length - 1][1].query
}

function manyInvoices(count: number) {
  return Array.from({ length: count }, (_, i) => makeInvoice(i + 1))
}

async function flush() {
  await act(async () => {})
}

describe("InvoicesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverInvoices = []
    installServer()
  })

  it("shows reference, supplier, invoice number, purchase, date, total and status", async () => {
    serverInvoices = [
      makeInvoice(1, {
        status: "posted",
        total: 1234.5,
        invoice_date: "2026-10-05",
      }),
      makeInvoice(2, {
        supplier: null,
        purchase: null,
        status: "void",
        total: 12.5,
      }),
    ]

    renderPage()

    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
    expect(screen.getByText("Acme Perfumes")).toBeInTheDocument()
    expect(screen.getByText("SUP-1")).toBeInTheDocument()
    expect(screen.getByText("PO-0001")).toBeInTheDocument()
    expect(
      screen.getAllByText(
        new Date("2026-10-05").toLocaleDateString(undefined, {
          timeZone: "UTC",
        })
      )
    ).toHaveLength(2)
    expect(screen.getByText("$1,234.50")).toBeInTheDocument()
    expect(screen.getByText("$12.50")).toBeInTheDocument()
    // The tab triggers share the status labels, so check the table rows.
    const rows = screen.getAllByRole("row")
    expect(rows[1]).toHaveTextContent("Posted")
    expect(rows[2]).toHaveTextContent("Void")
    // Missing supplier and purchase render a dash.
    expect(rows[2]).toHaveTextContent("—")
    expect(mockFetch).toHaveBeenCalledWith("/admin/invoices", {
      query: { limit: 20, offset: 0 },
    })
  })

  it("links the reference to /accounting/invoices/<id>", async () => {
    serverInvoices = [makeInvoice(1)]

    renderPage()

    const link = await screen.findByRole("link", { name: "INV-0001" })
    expect(link).toHaveAttribute("href", "/accounting/invoices/inv_1")
    fireEvent.click(link)
    expect(await screen.findByText("Detail page")).toBeInTheDocument()
  })

  it('a "New invoice" button links to /accounting/invoices/new', async () => {
    serverInvoices = [makeInvoice(1)]

    renderPage()
    await screen.findByText("INV-0001")

    const link = screen.getByRole("link", { name: "New invoice" })
    expect(link).toHaveAttribute("href", "/accounting/invoices/new")
    fireEvent.click(link)
    expect(await screen.findByText("New invoice page")).toBeInTheDocument()
  })

  it("status filter sends status and resets the offset to 0", async () => {
    serverInvoices = manyInvoices(45).map((i, idx) =>
      idx % 2 === 0 ? { ...i, status: "posted" } : i
    )

    renderPage()
    await screen.findByText("INV-0001")

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0021")
    expect(lastQuery()).toEqual({ limit: 20, offset: 20 })

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Posted" }))
    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 20, offset: 0, status: "posted" })
    )
    // Posted rows are the odd-numbered references.
    expect(await screen.findByText("INV-0001")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole("tab", { name: "All" }))
    await waitFor(() => expect(lastQuery()).toEqual({ limit: 20, offset: 0 }))
  })

  it("search sends q after a short debounce and resets the offset", async () => {
    serverInvoices = manyInvoices(45)

    renderPage()
    await screen.findByText("INV-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0021")

    fireEvent.change(screen.getByLabelText("Search invoices"), {
      target: { value: "SUP-3" },
    })
    // Not searched yet: the debounce has not elapsed.
    await flush()
    expect(listCalls().some((c) => c[1].query.q)).toBe(false)

    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "SUP-3" })
    )
    expect(await screen.findByText("SUP-3")).toBeInTheDocument()
    // The search never went out with the stale page-2 offset.
    expect(
      listCalls().filter((c) => c[1].query.q && c[1].query.offset !== 0)
    ).toEqual([])
  })

  it("pressing Enter searches immediately", async () => {
    serverInvoices = manyInvoices(45)

    renderPage()
    await screen.findByText("INV-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0021")

    const input = screen.getByLabelText("Search invoices")
    fireEvent.change(input, { target: { value: "SUP-4" } })
    fireEvent.keyDown(input, { key: "Enter" })

    // Well inside the 300ms debounce window.
    await waitFor(
      () => expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "SUP-4" }),
      { timeout: 150 }
    )
  })

  it("paginates with Next and Previous from count and offset", async () => {
    serverInvoices = manyInvoices(45)

    renderPage()
    await screen.findByText("INV-0001")

    const previous = screen.getByRole("button", { name: "Previous" })
    const next = screen.getByRole("button", { name: "Next" })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    fireEvent.click(next)
    await screen.findByText("INV-0021")
    expect(lastQuery().offset).toBe(20)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0041")
    expect(lastQuery().offset).toBe(40)
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    await screen.findByText("INV-0021")
    expect(lastQuery().offset).toBe(20)
  })

  it("clamps to the last valid page when the count shrinks", async () => {
    serverInvoices = manyInvoices(45)

    renderPage()
    await screen.findByText("INV-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0021")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0041")

    // Rows disappear on the server; the page refetches with a smaller count.
    serverInvoices = manyInvoices(25)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "invoices"] })
    })

    // 25 rows: the last valid page starts at offset 20.
    await waitFor(() => expect(lastQuery().offset).toBe(20))
    expect(await screen.findByText("INV-0025")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("clamps back to the first page when the count drops to zero", async () => {
    serverInvoices = manyInvoices(25)

    renderPage()
    await screen.findByText("INV-0001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("INV-0021")

    serverInvoices = []
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "invoices"] })
    })

    await waitFor(() => expect(lastQuery().offset).toBe(0))
    expect(await screen.findByText("No invoices yet.")).toBeInTheDocument()
  })

  it("does not refetch when nothing changed (no reset loops)", async () => {
    serverInvoices = manyInvoices(25)

    renderPage()
    await screen.findByText("INV-0001")
    await flush()
    const before = listCalls().length
    await flush()
    expect(listCalls().length).toBe(before)
  })

  it("per-tab empty text", async () => {
    renderPage()
    expect(await screen.findByText("No invoices yet.")).toBeInTheDocument()

    const expectations: [string, string][] = [
      ["Draft", "No draft invoices."],
      ["Posted", "No posted invoices."],
      ["Void", "No void invoices."],
    ]
    for (const [name, text] of expectations) {
      fireEvent.mouseDown(screen.getByRole("tab", { name }))
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
  })

  it("shows an error with a working Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    serverInvoices = [makeInvoice(1)]
    installServer()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
  })
})

describe("route configs", () => {
  it("labels the parent Accounting", () => {
    expect(accountingConfig.label).toBe("Accounting")
  })

  it("labels the list Invoices with no nested override", () => {
    expect(invoicesConfig.label).toBe("Invoices")
    expect((invoicesConfig as { nested?: string }).nested).toBeUndefined()
  })

  it("redirects /accounting to /accounting/invoices", async () => {
    serverInvoices = [makeInvoice(1)]
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/accounting"]}>
          <Routes>
            <Route path="/accounting" element={<AccountingPage />} />
            <Route path="/accounting/invoices" element={<InvoicesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole("heading", { name: "Invoices" })
    ).toBeInTheDocument()
    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
  })
})
