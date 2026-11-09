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
    paid_total: 0,
    balance: 73.75,
    payment_status: null,
    overdue: false,
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
  payments?: Record<string, any>[]
  failPost?: string
  failPayment?: string
  getFails?: Error
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_1",
    reference: "PAY-0001",
    amount: 20,
    paid_at: "2026-10-10",
    method: "bank_transfer",
    payment_reference: "WIRE-1",
    note: null,
    status: "recorded",
    voided_at: null,
    created_at: "2026-10-10T12:00:00.000Z",
    invoice: { id: "inv_1", reference: "INV-0001", invoice_number: "SUP-77" },
    supplier: { id: "sup_1", name: "Acme Perfumes" },
    ...overrides,
  }
}

// Recompute the invoice payment fields from the live payments, like the server.
function recompute(server: Server) {
  const cents = (server.payments ?? [])
    .filter((p) => p.status === "recorded")
    .reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
  const totalCents = Math.round(server.invoice.total * 100)
  server.invoice = {
    ...server.invoice,
    paid_total: cents / 100,
    balance: (totalCents - cents) / 100,
    payment_status:
      server.invoice.status !== "posted"
        ? null
        : cents === 0
          ? "unpaid"
          : cents >= totalCents
            ? "paid"
            : "partially_paid",
  }
}

function startServer(initial: Server) {
  const server = initial
  mockFetch.mockImplementation(
    (url: string, opts?: { method?: string; body?: Record<string, any> }) => {
      if (opts?.method === "POST" && url === "/admin/supplier-payments") {
        if (server.failPayment) {
          return Promise.reject(new Error(server.failPayment))
        }
        const body = opts.body ?? {}
        if (Math.round(body.amount * 100) > Math.round(server.invoice.balance * 100)) {
          return Promise.reject(
            new Error(
              `Amount ${body.amount} exceeds the invoice balance ${server.invoice.balance}`
            )
          )
        }
        const payment = makePayment({
          id: `pay_${(server.payments?.length ?? 0) + 1}`,
          reference: `PAY-000${(server.payments?.length ?? 0) + 1}`,
          amount: body.amount,
          paid_at: body.paid_at,
          method: body.method,
          payment_reference: body.reference ?? null,
          note: body.note ?? null,
        })
        server.payments = [payment, ...(server.payments ?? [])]
        recompute(server)
        return Promise.resolve(JSON.parse(JSON.stringify({ payment })))
      }
      if (opts?.method === "POST" && /supplier-payments\/.+\/void$/.test(url)) {
        if (server.failPayment) {
          return Promise.reject(new Error(server.failPayment))
        }
        const id = url.split("/")[3]
        server.payments = (server.payments ?? []).map((p) =>
          p.id === id ? { ...p, status: "void", voided_at: "2026-10-11T00:00:00.000Z" } : p
        )
        recompute(server)
        return Promise.resolve({ payment: server.payments.find((p) => p.id === id) })
      }
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
          const live = (server.payments ?? []).filter((p) => p.status === "recorded")
          if (live.length > 0) {
            return Promise.reject(
              new Error(
                `Invoice SUP-77 has ${live.length} payment(s); void the payments first`
              )
            )
          }
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
        if (url.endsWith("/post")) {
          recompute(server)
        }
        return Promise.resolve(JSON.parse(JSON.stringify({ invoice: server.invoice })))
      }
      if (server.getFails) {
        return Promise.reject(server.getFails)
      }
      return Promise.resolve(
        JSON.parse(
          JSON.stringify({
            invoice: server.invoice,
            comparison: server.comparison,
            payments: server.payments,
          })
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

    it("keeps unsaved edits when Void fails with a toast", async () => {
      const server = startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()
      fireEvent.change(field, { target: { value: "SUP-TYPED" } })

      server.failPost = "Cannot void"
      fireEvent.click(screen.getByRole("button", { name: "Void" }))
      await confirmDialog("Void invoice")
      await screen.findByText("Cannot void")

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

    it("disables Post with a hint while edits are unsaved, and re-enables it after Save or Cancel", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      const field = await openEditor()
      const post = () => screen.getByRole("button", { name: "Post" })
      expect(post()).toBeEnabled()
      expect(screen.queryByText("Save or cancel your edits first")).not.toBeInTheDocument()

      fireEvent.change(field, { target: { value: "SUP-78" } })
      expect(post()).toBeDisabled()
      expect(screen.getByText("Save or cancel your edits first")).toBeInTheDocument()
      fireEvent.click(post())
      await flush()
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
      expect(postCalls()).toHaveLength(0)

      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      await waitFor(() => expect(post()).toBeEnabled())
      expect(screen.queryByText("Save or cancel your edits first")).not.toBeInTheDocument()

      fireEvent.change(screen.getByLabelText("Invoice number"), {
        target: { value: "SUP-79" },
      })
      expect(post()).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(post()).toBeEnabled())
      expect(screen.queryByText("Save or cancel your edits first")).not.toBeInTheDocument()
    })

    it("disables Post, Void and Edit while a Save is in flight", async () => {
      const server = startServer({ invoice: makeInvoice(), comparison: null })
      const base = mockFetch.getMockImplementation()!
      let release: () => void = () => {}
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (opts?.method === "POST") {
          return new Promise((resolve) => {
            release = () => resolve(base(url, opts))
          })
        }
        return base(url, opts)
      })
      const field = await openEditor()
      fireEvent.change(field, { target: { value: "SUP-78" } })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(postCalls()).toHaveLength(1))
      await waitFor(() => expect(screen.getByRole("button", { name: "Void" })).toBeDisabled())
      expect(screen.getByRole("button", { name: "Post" })).toBeDisabled()
      release()
      await waitFor(() => expect(screen.getByRole("button", { name: "Void" })).toBeEnabled())
      expect(server.invoice.invoice_number).toBe("SUP-78")
    })

    it("disables Save and Cancel while Post is in flight", async () => {
      startServer({ invoice: makeInvoice(), comparison: null })
      const base = mockFetch.getMockImplementation()!
      let release: () => void = () => {}
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (opts?.method === "POST") {
          return new Promise((resolve) => {
            release = () => resolve(base(url, opts))
          })
        }
        return base(url, opts)
      })
      await openEditor()
      fireEvent.click(screen.getByRole("button", { name: "Post" }))
      await confirmDialog("Post invoice")

      await waitFor(() => expect(postCalls()).toHaveLength(1))
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
      release()
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("Posted")
      )
    })

    it("has no editor on a posted invoice", async () => {
      startServer({ invoice: makeInvoice({ status: "posted" }), comparison: null })
      renderPage()
      await screen.findByText("INV-0001")
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
      expect(screen.queryByLabelText("Invoice number")).not.toBeInTheDocument()
    })
  })

  describe("payments", () => {
    function postedServer(extra: Partial<Server> = {}) {
      const server: Server = {
        invoice: makeInvoice({
          status: "posted",
          payment_status: "unpaid",
          posted_at: "2026-10-06T10:00:00.000Z",
        }),
        comparison: null,
        payments: [],
        ...extra,
      }
      startServer(server)
      return server
    }

    async function openDialog() {
      renderPage()
      await screen.findByText("INV-0001")
      fireEvent.click(screen.getByRole("button", { name: "Record payment" }))
      return screen.findByLabelText("Amount")
    }

    function paymentCalls() {
      return postCalls().filter((c) => c[0] === "/admin/supplier-payments")
    }

    it("shows Paid, Balance and the payment status badge on a posted invoice", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "partially_paid",
          paid_total: 20,
          balance: 53.75,
        }),
        payments: [makePayment()],
      })
      renderPage()
      await screen.findByText("INV-0001")

      expect(screen.getByTestId("paid-total")).toHaveTextContent("$20.00")
      expect(screen.getByTestId("balance")).toHaveTextContent("$53.75")
      expect(screen.getByTestId("payment-status")).toHaveTextContent("Part paid")
      expect(screen.queryByTestId("overdue")).not.toBeInTheDocument()
    })

    it("shows an Overdue badge when the invoice is overdue", async () => {
      postedServer({
        invoice: makeInvoice({ status: "posted", payment_status: "unpaid", overdue: true }),
      })
      renderPage()
      await screen.findByText("INV-0001")

      expect(screen.getByTestId("overdue")).toHaveTextContent("Overdue")
    })

    it("shows no payment badge, totals or Record payment on a draft or void invoice", async () => {
      for (const status of ["draft", "void"]) {
        startServer({
          invoice: makeInvoice({ status, payment_status: null }),
          comparison: null,
          payments: [],
        })
        const { unmount } = renderPage()
        await screen.findByText("INV-0001")
        expect(screen.queryByTestId("payment-status")).not.toBeInTheDocument()
        expect(screen.queryByTestId("balance")).not.toBeInTheDocument()
        expect(
          screen.queryByRole("button", { name: "Record payment" })
        ).not.toBeInTheDocument()
        unmount()
      }
    })

    it("hides Record payment on a fully paid posted invoice", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "paid",
          paid_total: 73.75,
          balance: 0,
        }),
        payments: [makePayment({ amount: 73.75 })],
      })
      renderPage()
      await screen.findByText("INV-0001")

      expect(
        screen.queryByRole("button", { name: "Record payment" })
      ).not.toBeInTheDocument()
    })

    it("treats a missing payments key as no payments", async () => {
      postedServer()
      renderPage()
      await screen.findByText("INV-0001")

      expect(screen.getByText("No payments recorded.")).toBeInTheDocument()
    })

    it("lists payments as returned with method label, reference, amount and status", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "partially_paid",
          paid_total: 20,
          balance: 53.75,
        }),
        payments: [
          makePayment(),
          makePayment({
            id: "pay_2",
            reference: "PAY-0002",
            amount: 5,
            method: "cheque",
            payment_reference: null,
            status: "void",
          }),
          makePayment({
            id: "pay_3",
            reference: "PAY-0003",
            method: "crypto",
            status: "frozen",
          }),
        ],
      })
      renderPage()
      await screen.findByText("INV-0001")

      const [first, second, third] = screen.getAllByTestId("payment-row")
      expect(within(first).getByText("Bank transfer")).toBeInTheDocument()
      expect(within(first).getByText("WIRE-1")).toBeInTheDocument()
      expect(within(first).getByText("$20.00")).toBeInTheDocument()
      expect(within(first).getByText("Recorded")).toBeInTheDocument()
      expect(
        within(first).getByRole("button", { name: "Void payment PAY-0001" })
      ).toBeInTheDocument()

      expect(within(second).getByText("Cheque")).toBeInTheDocument()
      expect(within(second).getByText("—")).toBeInTheDocument()
      expect(within(second).getByText("Void")).toBeInTheDocument()
      expect(within(second).queryByRole("button")).not.toBeInTheDocument()

      expect(within(third).getByText("crypto")).toBeInTheDocument()
      expect(within(third).getByText("frozen")).toBeInTheDocument()
      expect(within(third).queryByRole("button")).not.toBeInTheDocument()
    })

    it("opens the dialog with the amount prefilled to the balance, today's date and bank transfer", async () => {
      postedServer()
      const amount = await openDialog()

      expect(amount).toHaveValue("73.75")
      expect(screen.getByLabelText("Payment date")).toHaveValue(
        new Date().toISOString().slice(0, 10)
      )
      expect(screen.getByLabelText("Method")).toHaveValue("bank_transfer")
      expect(screen.getByLabelText("Reference")).toHaveValue("")
      expect(screen.getByLabelText("Note")).toHaveValue("")
    })

    it("posts exactly the required fields and omits blank optionals", async () => {
      postedServer()
      const amount = await openDialog()

      fireEvent.change(amount, { target: { value: "30.5" } })
      fireEvent.change(screen.getByLabelText("Payment date"), {
        target: { value: "2026-10-12" },
      })
      fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "   " } })
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))

      await waitFor(() => expect(paymentCalls()).toHaveLength(1))
      expect(paymentCalls()[0]).toEqual([
        "/admin/supplier-payments",
        {
          method: "POST",
          body: {
            invoice_id: "inv_1",
            amount: 30.5,
            paid_at: "2026-10-12",
            method: "bank_transfer",
          },
        },
      ])
    })

    it("sends reference, note and method when filled, then closes, toasts and refetches", async () => {
      postedServer()
      const amount = await openDialog()

      fireEvent.change(amount, { target: { value: "30" } })
      fireEvent.change(screen.getByLabelText("Method"), { target: { value: "cash" } })
      fireEvent.change(screen.getByLabelText("Reference"), {
        target: { value: " WIRE-9 " },
      })
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "part one" } })
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))

      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Payment recorded")
      )
      expect(paymentCalls()[0][1].body).toMatchObject({
        amount: 30,
        method: "cash",
        reference: "WIRE-9",
        note: "part one",
      })
      await waitFor(() =>
        expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument()
      )
      await waitFor(() =>
        expect(screen.getByTestId("balance")).toHaveTextContent("$43.75")
      )
      expect(screen.getByTestId("payment-status")).toHaveTextContent("Part paid")
      expect(screen.getAllByTestId("payment-row")).toHaveLength(1)
    })

    it("invalidates every shared query prefix after recording", async () => {
      postedServer()
      const amount = await openDialog()
      const spy = jest.spyOn(queryClient, "invalidateQueries")

      fireEvent.change(amount, { target: { value: "10" } })
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Payment recorded")
      )

      const keys = spy.mock.calls.map((c) => (c[0] as any).queryKey)
      for (const key of [
        "invoices",
        "supplier-payments",
        "supplier-balances",
        "purchase-invoices",
        "invoice-purchase-options",
      ]) {
        expect(keys).toContainEqual(["admin", key])
      }
    })

    it.each([
      [""],
      ["abc"],
      ["0"],
      ["0.00"],
      ["-5"],
      ["10.505"],
      ["73.76"],
      ["1e2"],
      ["100"],
    ])("rejects amount %j inline without posting", async (value) => {
      postedServer()
      const amount = await openDialog()

      fireEvent.change(amount, { target: { value } })
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))

      const alert = await screen.findByRole("alert")
      expect(alert).toHaveTextContent("73.75")
      await flush()
      expect(paymentCalls()).toHaveLength(0)
      // The unreadable input is kept, never cleared or turned into 0.
      expect(screen.getByLabelText("Amount")).toHaveValue(value)
    })

    it("allows paying exactly the balance, compared in cents", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "unpaid",
          total: 0.3,
          balance: 0.3,
        }),
      })
      const amount = await openDialog()
      fireEvent.change(amount, { target: { value: "0.30" } })
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))

      await waitFor(() => expect(paymentCalls()).toHaveLength(1))
      expect(paymentCalls()[0][1].body.amount).toBe(0.3)
    })

    it("shows a server 400 inline and keeps the dialog open with the typed values", async () => {
      const server = postedServer()
      const amount = await openDialog()
      server.failPayment = "Amount 50 exceeds the invoice balance 40"

      fireEvent.change(amount, { target: { value: "50" } })
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "typed" } })
      // The client check passes at 50 <= 73.75; the server then refuses.
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))

      expect(
        await screen.findByText("Amount 50 exceeds the invoice balance 40")
      ).toBeInTheDocument()
      expect(screen.getByLabelText("Amount")).toHaveValue("50")
      expect(screen.getByLabelText("Note")).toHaveValue("typed")
      expect(mockToast.success).not.toHaveBeenCalled()
      expect(screen.getByRole("button", { name: "Save payment" })).toBeEnabled()
    })

    it("does not reset the dialog fields when the invoice refetches in the background", async () => {
      const server = postedServer()
      const amount = await openDialog()

      fireEvent.change(amount, { target: { value: "12.34" } })
      fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "KEEP" } })
      fireEvent.change(screen.getByLabelText("Method"), { target: { value: "card" } })

      server.invoice = makeInvoice({
        status: "posted",
        payment_status: "unpaid",
        balance: 73.75,
        tax: 9,
      })
      await refetchDetail()
      await waitFor(() =>
        expect(screen.getByTestId("tax")).toHaveTextContent("$9.00")
      )

      expect(screen.getByLabelText("Amount")).toHaveValue("12.34")
      expect(screen.getByLabelText("Reference")).toHaveValue("KEEP")
      expect(screen.getByLabelText("Method")).toHaveValue("card")
    })

    it("disables submit, Void and Post while the payment is in flight (no double submit)", async () => {
      postedServer()
      const base = mockFetch.getMockImplementation()!
      let release: () => void = () => {}
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (opts?.method === "POST") {
          return new Promise((resolve) => {
            release = () => resolve(base(url, opts))
          })
        }
        return base(url, opts)
      })
      const amount = await openDialog()
      fireEvent.change(amount, { target: { value: "10" } })
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))

      await waitFor(() => expect(paymentCalls()).toHaveLength(1))
      const submit = screen.getByRole("button", { name: "Save payment" })
      expect(submit).toBeDisabled()
      fireEvent.click(submit)
      fireEvent.submit(submit.closest("form")!)
      await flush()
      expect(paymentCalls()).toHaveLength(1)

      release()
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Payment recorded")
      )
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Void" })).toBeEnabled()
      )
    })

    it("disables Void invoice and every payment Void while a payment is recording", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "partially_paid",
          paid_total: 20,
          balance: 53.75,
        }),
        payments: [makePayment()],
      })
      const base = mockFetch.getMockImplementation()!
      let release: () => void = () => {}
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (opts?.method === "POST") {
          return new Promise((resolve) => {
            release = () => resolve(base(url, opts))
          })
        }
        return base(url, opts)
      })
      await openDialog()
      fireEvent.click(screen.getByRole("button", { name: "Save payment" }))
      await waitFor(() => expect(paymentCalls()).toHaveLength(1))

      // The dialog hides the page from the accessibility tree; query hidden.
      expect(
        screen.getByRole("button", { name: "Void", hidden: true })
      ).toBeDisabled()
      expect(
        screen.getByRole("button", { name: "Void payment PAY-0001", hidden: true })
      ).toBeDisabled()
      expect(
        screen.getByRole("button", { name: "Record payment", hidden: true })
      ).toBeDisabled()
      release()
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Payment recorded")
      )
    })

    it("disables Record payment while the invoice Void is in flight", async () => {
      postedServer()
      const base = mockFetch.getMockImplementation()!
      let release: () => void = () => {}
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (opts?.method === "POST") {
          return new Promise((resolve) => {
            release = () => resolve(base(url, opts))
          })
        }
        return base(url, opts)
      })
      renderPage()
      await screen.findByText("INV-0001")
      fireEvent.click(screen.getByRole("button", { name: "Void" }))
      await confirmDialog("Void invoice")

      await waitFor(() => expect(postCalls()).toHaveLength(1))
      expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled()
      release()
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("Void")
      )
    })

    it("voids a payment only after confirmation and updates the balance", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "partially_paid",
          paid_total: 20,
          balance: 53.75,
        }),
        payments: [makePayment()],
      })
      renderPage()
      await screen.findByText("INV-0001")

      fireEvent.click(screen.getByRole("button", { name: "Void payment PAY-0001" }))
      const dialog = await screen.findByRole("alertdialog")
      await flush()
      expect(postCalls()).toHaveLength(0)

      fireEvent.click(within(dialog).getByRole("button", { name: "Keep payment" }))
      await waitFor(() =>
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
      )
      await flush()
      expect(postCalls()).toHaveLength(0)

      fireEvent.click(screen.getByRole("button", { name: "Void payment PAY-0001" }))
      await confirmDialog("Void payment")
      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith("/admin/supplier-payments/pay_1/void", {
          method: "POST",
        })
      )
      await waitFor(() =>
        expect(screen.getByTestId("balance")).toHaveTextContent("$73.75")
      )
      expect(screen.getByTestId("payment-status")).toHaveTextContent("Unpaid")
      const [row] = screen.getAllByTestId("payment-row")
      expect(within(row).getByText("Void")).toBeInTheDocument()
      expect(within(row).queryByRole("button")).not.toBeInTheDocument()
      expect(mockToast.success).toHaveBeenCalledWith("Payment voided")
    })

    it("shows the server message when voiding the invoice with live payments", async () => {
      postedServer({
        invoice: makeInvoice({
          status: "posted",
          payment_status: "partially_paid",
          paid_total: 20,
          balance: 53.75,
        }),
        payments: [makePayment()],
      })
      renderPage()
      await screen.findByText("INV-0001")

      fireEvent.click(screen.getByRole("button", { name: "Void" }))
      await confirmDialog("Void invoice")

      const message = "Invoice SUP-77 has 1 payment(s); void the payments first"
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(mockToast.error).toHaveBeenCalledWith(message)
      expect(screen.getByTestId("status")).toHaveTextContent("Posted")
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
