/**
 * @jest-environment jsdom
 */
import "../../../../purchases/__tests__/text-encoder-polyfill"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const mockFetch = jest.fn()
const mockToast = { success: jest.fn(), error: jest.fn() }

jest.mock("../../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

jest.mock("@medusajs/ui", () => ({
  ...jest.requireActual("@medusajs/ui"),
  toast: {
    success: (...args: unknown[]) => mockToast.success(...args),
    error: (...args: unknown[]) => mockToast.error(...args),
  },
}))

import InvoiceDetailPage from "../page"

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/invoices/inv_1"]}>
        <Routes>
          <Route path="/accounting/invoices/:id" element={<InvoiceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    reference: "INV-0001",
    status: "draft",
    invoice_number: "SUP-77",
    invoice_date: "2026-10-05",
    due_date: "2026-11-05",
    supplier: { id: "sup_1", name: "Acme Perfumes" },
    purchase: { id: "pur_1", reference: "PO-0001" },
    items: [
      {
        id: "iitem_1",
        purchase_item_id: "pitem_1",
        variant_id: "variant_1",
        supplier_sku: "ACME-OUD",
        description: "Midnight Oud 50ml",
        quantity: 4,
        unit_cost: 12.5,
        line_total: 50,
      },
      {
        id: "iitem_2",
        purchase_item_id: null,
        variant_id: "variant_2",
        supplier_sku: "",
        description: "Rose 30ml",
        quantity: 2,
        unit_cost: 7,
        line_total: 14,
      },
    ],
    shipping_cost: 5,
    tax: 3.25,
    other_cost: 1.5,
    subtotal: 64,
    total: 73.75,
    notes: "Handle with care",
    posted_at: null,
    voided_at: null,
    created_at: "2026-10-05T12:00:00.000Z",
    ...overrides,
  }
}

function makeComparison(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        purchase_item_id: "pitem_1",
        variant_id: "variant_1",
        title: "Midnight Oud 50ml",
        ordered_quantity: 10,
        received_quantity: 3,
        invoiced_quantity: 4,
        invoiced_quantity_total: 12,
        ordered_unit_cost: 11,
        invoiced_unit_cost: 12.5,
        flags: {
          price_difference: true,
          over_received: true,
          over_ordered: true,
          not_on_purchase: false,
        },
      },
      {
        purchase_item_id: null,
        variant_id: "variant_2",
        title: "Rose 30ml",
        ordered_quantity: 0,
        received_quantity: 0,
        invoiced_quantity: 2,
        invoiced_quantity_total: 2,
        ordered_unit_cost: null,
        invoiced_unit_cost: 7,
        flags: {
          price_difference: false,
          over_received: false,
          over_ordered: false,
          not_on_purchase: true,
        },
      },
    ],
    purchase_total: 60,
    invoice_total: 73.75,
    difference: 13.75,
    ...overrides,
  }
}

// A stateful fake server: GET returns fresh copies of the current state, and
// post/void/update mutate it.
type Server = {
  invoice: Record<string, any>
  comparison: Record<string, any> | null
  failPost?: string
  getFails?: Error
}

function startServer(initial: Server) {
  const server = initial
  mockFetch.mockImplementation(
    (url: string, opts?: { method?: string; body?: Record<string, any> }) => {
      if (opts?.method === "POST") {
        if (server.failPost) {
          return Promise.reject(new Error(server.failPost))
        }
        if (url.endsWith("/post")) {
          server.invoice = {
            ...server.invoice,
            status: "posted",
            posted_at: "2026-10-06T10:00:00.000Z",
          }
        } else if (url.endsWith("/void")) {
          server.invoice = {
            ...server.invoice,
            status: "void",
            voided_at: "2026-10-07T10:00:00.000Z",
          }
        } else {
          const { items, ...header } = opts.body ?? {}
          server.invoice = { ...server.invoice, ...header }
          if (items) {
            server.invoice.items = items.map((item: any, index: number) => ({
              ...server.invoice.items[index],
              ...item,
            }))
          }
        }
        return Promise.resolve(JSON.parse(JSON.stringify({ invoice: server.invoice })))
      }
      if (server.getFails) {
        return Promise.reject(server.getFails)
      }
      return Promise.resolve(
        JSON.parse(
          JSON.stringify({ invoice: server.invoice, comparison: server.comparison })
        )
      )
    }
  )
  return server
}

function postCalls() {
  return mockFetch.mock.calls.filter((c) => c[1]?.method === "POST")
}

async function flush() {
  await act(async () => {})
}

async function refetchDetail() {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "invoices"] })
  })
}

async function confirmDialog(name: string) {
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name }))
}

function buttonNames() {
  return ["Post", "Void", "Edit"].filter(
    (name) => screen.queryByRole("button", { name }) !== null
  )
}

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("shows the header, lines, comparison and totals", async () => {
    startServer({ invoice: makeInvoice(), comparison: makeComparison() })
    renderPage()

    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/admin/invoices/inv_1")
    expect(screen.getByTestId("status")).toHaveTextContent("Draft")
    expect(screen.getByTestId("invoice-number")).toHaveTextContent("SUP-77")
    expect(screen.getByText(/Acme Perfumes/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "PO-0001" })).toHaveAttribute(
      "href",
      "/purchases/pur_1"
    )
    expect(screen.getByTestId("invoice-date")).toHaveTextContent(
      new Date("2026-10-05").toLocaleDateString(undefined, { timeZone: "UTC" })
    )
    expect(screen.getByTestId("due-date")).toHaveTextContent(
      new Date("2026-11-05").toLocaleDateString(undefined, { timeZone: "UTC" })
    )
    expect(screen.queryByTestId("posted-at")).not.toBeInTheDocument()
    expect(screen.queryByTestId("voided-at")).not.toBeInTheDocument()

    const [oudRow, roseRow] = screen.getAllByTestId("line-row")
    expect(within(oudRow).getByText("Midnight Oud 50ml")).toBeInTheDocument()
    expect(within(oudRow).getByText("ACME-OUD")).toBeInTheDocument()
    expect(within(oudRow).getByText("$12.50")).toBeInTheDocument()
    expect(within(oudRow).getByText("$50.00")).toBeInTheDocument()
    expect(within(roseRow).getByText("—")).toBeInTheDocument()
    expect(within(roseRow).getByText("$14.00")).toBeInTheDocument()

    expect(screen.getByTestId("subtotal")).toHaveTextContent("$64.00")
    expect(screen.getByTestId("shipping-cost")).toHaveTextContent("$5.00")
    expect(screen.getByTestId("tax")).toHaveTextContent("$3.25")
    expect(screen.getByTestId("other-cost")).toHaveTextContent("$1.50")
    expect(screen.getByTestId("total")).toHaveTextContent("$73.75")
  })

  it("shows posted and voided timestamps when set", async () => {
    startServer({
      invoice: makeInvoice({
        status: "void",
        posted_at: "2026-10-06T10:00:00.000Z",
        voided_at: "2026-10-07T10:00:00.000Z",
      }),
      comparison: makeComparison(),
    })
    renderPage()
    await screen.findByText("INV-0001")

    expect(screen.getByTestId("posted-at")).toHaveTextContent(
      new Date("2026-10-06T10:00:00.000Z").toLocaleString()
    )
    expect(screen.getByTestId("voided-at")).toHaveTextContent(
      new Date("2026-10-07T10:00:00.000Z").toLocaleString()
    )
  })

  it("shows the comparison with all four warning badges and header totals", async () => {
    startServer({ invoice: makeInvoice(), comparison: makeComparison() })
    renderPage()
    await screen.findByText("INV-0001")

    const [oudRow, roseRow] = screen.getAllByTestId("comparison-row")
    for (const cell of ["10", "3", "4", "12", "$11.00", "$12.50"]) {
      expect(within(oudRow).getByText(cell)).toBeInTheDocument()
    }
    expect(within(oudRow).getByText("Price difference")).toBeInTheDocument()
    expect(within(oudRow).getByText("Billed above received")).toBeInTheDocument()
    expect(within(oudRow).getByText("Billed above ordered")).toBeInTheDocument()
    expect(within(oudRow).queryByText("Not on purchase")).not.toBeInTheDocument()

    expect(within(roseRow).getByText("Not on purchase")).toBeInTheDocument()
    expect(within(roseRow).queryByText("Price difference")).not.toBeInTheDocument()
    // No ordered cost on a line that is not on the purchase.
    expect(within(roseRow).getByText("—")).toBeInTheDocument()

    expect(screen.getByTestId("purchase-total")).toHaveTextContent("$60.00")
    expect(screen.getByTestId("comparison-invoice-total")).toHaveTextContent(
      "$73.75"
    )
    expect(screen.getByTestId("comparison-difference")).toHaveTextContent("$13.75")
  })

  it("copes with a missing supplier, purchase, due date, notes and comparison", async () => {
    startServer({
      invoice: makeInvoice({
        supplier: null,
        purchase: null,
        due_date: null,
        notes: null,
      }),
      comparison: null,
    })
    renderPage()

    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
    expect(screen.getByTestId("due-date")).toHaveTextContent("—")
    expect(screen.getByText(/^Supplier:/)).toHaveTextContent("Supplier: —")
    expect(screen.getByText(/^Purchase:/)).toHaveTextContent("Purchase: —")
    expect(screen.queryByRole("link", { name: "PO-0001" })).not.toBeInTheDocument()
    expect(screen.getByText("No comparison available.")).toBeInTheDocument()
  })

  it("shows Post, Void and Edit on a draft, only Void on a posted invoice and none on a void one", async () => {
    const expected: Record<string, string[]> = {
      draft: ["Post", "Void", "Edit"],
      posted: ["Void"],
      void: [],
    }
    for (const [status, names] of Object.entries(expected)) {
      startServer({ invoice: makeInvoice({ status }), comparison: null })
      const { unmount } = renderPage()
      await screen.findByText("INV-0001")
      expect(buttonNames()).toEqual(names)
      unmount()
    }
  })

  it("falls back to the raw text for an unknown status and offers no actions", async () => {
    startServer({ invoice: makeInvoice({ status: "pending_review" }), comparison: null })
    renderPage()
    await screen.findByText("INV-0001")

    expect(screen.getByTestId("status")).toHaveTextContent("pending_review")
    expect(buttonNames()).toEqual([])
  })

  it("asks for confirmation before voiding and only then calls the route", async () => {
    startServer({ invoice: makeInvoice({ status: "posted" }), comparison: null })
    renderPage()
    await screen.findByText("INV-0001")

    fireEvent.click(screen.getByRole("button", { name: "Void" }))
    const dialog = await screen.findByRole("alertdialog")
    await flush()
    expect(postCalls()).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep invoice" }))
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    await flush()
    expect(postCalls()).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Void" }))
    await confirmDialog("Void invoice")
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/invoices/inv_1/void", {
        method: "POST",
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("Void")
    )
    expect(screen.getByTestId("voided-at")).toBeInTheDocument()
    expect(buttonNames()).toEqual([])
    expect(mockToast.success).toHaveBeenCalledWith("Invoice voided")
  })

  it("posts a draft after confirmation and refreshes the status", async () => {
    startServer({ invoice: makeInvoice(), comparison: null })
    renderPage()
    await screen.findByText("INV-0001")

    fireEvent.click(screen.getByRole("button", { name: "Post" }))
    await screen.findByRole("alertdialog")
    await flush()
    expect(postCalls()).toHaveLength(0)
    await confirmDialog("Post invoice")

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/invoices/inv_1/post", {
        method: "POST",
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("Posted")
    )
    expect(buttonNames()).toEqual(["Void"])
    expect(mockToast.success).toHaveBeenCalledWith("Invoice posted")
  })

  it("shows a server error from an action inline and as a toast", async () => {
    const server = startServer({ invoice: makeInvoice(), comparison: null })
    server.failPost = "Invoice has no lines"
    renderPage()
    await screen.findByText("INV-0001")

    fireEvent.click(screen.getByRole("button", { name: "Post" }))
    await confirmDialog("Post invoice")

    expect(await screen.findByText("Invoice has no lines")).toBeInTheDocument()
    expect(mockToast.error).toHaveBeenCalledWith("Invoice has no lines")
    expect(screen.getByTestId("status")).toHaveTextContent("Draft")
    expect(screen.getByRole("button", { name: "Post" })).toBeInTheDocument()
  })

  it("invalidates the shared invoice query prefixes after an action", async () => {
    startServer({ invoice: makeInvoice(), comparison: null })
    renderPage()
    await screen.findByText("INV-0001")
    const spy = jest.spyOn(queryClient, "invalidateQueries")

    fireEvent.click(screen.getByRole("button", { name: "Post" }))
    await confirmDialog("Post invoice")
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("Posted")
    )

    const keys = spy.mock.calls.map((c) => (c[0] as any).queryKey)
    expect(keys).toContainEqual(["admin", "invoices"])
    expect(keys).toContainEqual(["admin", "purchase-invoices"])
    expect(keys).toContainEqual(["admin", "invoice-purchase-options"])
  })

  describe("editing a draft", () => {
    async function openEditor() {
      renderPage()
      await screen.findByText("INV-0001")
      fireEvent.click(screen.getByRole("button", { name: "Edit" }))
      return screen.findByLabelText("Invoice number")
    }

    it("saves only the changed header fields and leaves the lines out", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()

      fireEvent.change(field, { target: { value: "SUP-78" } })
      fireEvent.change(screen.getByLabelText("Tax"), { target: { value: "4" } })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(postCalls()).toHaveLength(1))
      expect(postCalls()[0]).toEqual([
        "/admin/invoices/inv_1",
        { method: "POST", body: { invoice_number: "SUP-78", tax: 4 } },
      ])
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Invoice updated")
      )
      await waitFor(() =>
        expect(screen.getByTestId("tax")).toHaveTextContent("$4.00")
      )
    })

    it("sends the full items array when a line changed", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      await openEditor()

      fireEvent.change(screen.getByLabelText("Quantity for Midnight Oud 50ml"), {
        target: { value: "5" },
      })
      fireEvent.change(screen.getByLabelText("Unit cost for Rose 30ml"), {
        target: { value: "7.5" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(postCalls()).toHaveLength(1))
      expect(postCalls()[0][1].body).toEqual({
        items: [
          {
            variant_id: "variant_1",
            purchase_item_id: "pitem_1",
            supplier_sku: "ACME-OUD",
            description: "Midnight Oud 50ml",
            quantity: 5,
            unit_cost: 12.5,
          },
          {
            variant_id: "variant_2",
            description: "Rose 30ml",
            quantity: 2,
            unit_cost: 7.5,
          },
        ],
      })
    })

    it("clears the due date and notes with null", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      await openEditor()

      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "" } })
      fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "" } })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(postCalls()).toHaveLength(1))
      expect(postCalls()[0][1].body).toEqual({ due_date: null, notes: null })
    })

    it("does not post when nothing changed, even after a flush", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      await openEditor()

      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      expect(await screen.findByText("No changes to save.")).toBeInTheDocument()
      await flush()
      expect(postCalls()).toHaveLength(0)
    })

    it("does not post a header edit that was typed back to the original", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      await openEditor()

      fireEvent.change(screen.getByLabelText("Shipping cost"), {
        target: { value: "9" },
      })
      fireEvent.change(screen.getByLabelText("Shipping cost"), {
        target: { value: "5" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      await screen.findByText("No changes to save.")
      await flush()
      expect(postCalls()).toHaveLength(0)
    })

    it.each([
      ["Quantity for Midnight Oud 50ml", ""],
      ["Quantity for Midnight Oud 50ml", "abc"],
      ["Quantity for Midnight Oud 50ml", "2.5"],
      ["Quantity for Midnight Oud 50ml", "0"],
      ["Quantity for Midnight Oud 50ml", "-1"],
      ["Unit cost for Midnight Oud 50ml", ""],
      ["Unit cost for Midnight Oud 50ml", "-3"],
      ["Unit cost for Midnight Oud 50ml", "abc"],
      ["Shipping cost", ""],
      ["Shipping cost", "-1"],
      ["Tax", "abc"],
      ["Other cost", ""],
    ])("rejects %s = %j without posting", async (label, value) => {
      startServer({ invoice: makeInvoice(), comparison: null })
      await openEditor()

      fireEvent.change(screen.getByLabelText(label), { target: { value } })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))

      expect(await screen.findByRole("alert")).toBeInTheDocument()
      await flush()
      expect(postCalls()).toHaveLength(0)
    })

    it("shows a server error inline and as a toast and keeps the typed values", async () => {
      const server = startServer({ invoice: makeInvoice(), comparison: null })
      server.failPost = "Invoice number already used"
      const field = await openEditor()

      fireEvent.change(field, { target: { value: "SUP-78" } })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))

      expect(
        await screen.findByText("Invoice number already used")
      ).toBeInTheDocument()
      expect(mockToast.error).toHaveBeenCalledWith("Invoice number already used")
      expect(screen.getByLabelText("Invoice number")).toHaveValue("SUP-78")
    })

    it("keeps unsaved edits through a background refetch with new server data", async () => {
      const server = startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()

      fireEvent.change(field, { target: { value: "SUP-TYPED" } })
      fireEvent.change(screen.getByLabelText("Quantity for Rose 30ml"), {
        target: { value: "9" },
      })

      server.invoice = makeInvoice({ invoice_number: "SUP-FROM-SERVER", tax: 8 })
      await refetchDetail()
      await waitFor(() =>
        expect(screen.getByTestId("tax")).toHaveTextContent("$8.00")
      )

      expect(screen.getByLabelText("Invoice number")).toHaveValue("SUP-TYPED")
      expect(screen.getByLabelText("Quantity for Rose 30ml")).toHaveValue(9)
    })

    it("keeps unsaved edits after a failed refetch", async () => {
      const server = startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()
      fireEvent.change(field, { target: { value: "SUP-TYPED" } })

      server.getFails = new Error("network down")
      await refetchDetail()
      await flush()

      expect(screen.getByLabelText("Invoice number")).toHaveValue("SUP-TYPED")
    })

    it("keeps unsaved edits when Post fails with a toast", async () => {
      const server = startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()
      fireEvent.change(field, { target: { value: "SUP-TYPED" } })

      server.failPost = "Cannot post"
      fireEvent.click(screen.getByRole("button", { name: "Post" }))
      await confirmDialog("Post invoice")
      await screen.findByText("Cannot post")

      expect(screen.getByLabelText("Invoice number")).toHaveValue("SUP-TYPED")
    })

    it("resets the form to the saved values only after a successful save", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()

      fireEvent.change(field, { target: { value: "  SUP-78  " } })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      await waitFor(() => expect(postCalls()).toHaveLength(1))
      await waitFor(() =>
        expect(screen.getByLabelText("Invoice number")).toHaveValue("SUP-78")
      )

      // A second save without edits has nothing to send.
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      await screen.findByText("No changes to save.")
      await flush()
      expect(postCalls()).toHaveLength(1)
    })

    it("has no editor on a posted invoice", async () => {
      startServer({ invoice: makeInvoice({ status: "posted" }), comparison: null })
      renderPage()
      await screen.findByText("INV-0001")
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
      expect(screen.queryByLabelText("Invoice number")).not.toBeInTheDocument()
    })
  })

  it('shows "Invoice not found" on a 404', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }))
    renderPage()

    expect(await screen.findByText("Invoice not found")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
  })

  it("shows an error with Retry when loading fails", async () => {
    const server = startServer({ invoice: makeInvoice(), comparison: null })
    server.getFails = new Error("boom")
    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    delete server.getFails
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("INV-0001")).toBeInTheDocument()
  })
})
