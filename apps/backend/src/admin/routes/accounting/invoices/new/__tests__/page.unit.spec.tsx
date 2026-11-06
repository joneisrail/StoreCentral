/**
 * @jest-environment jsdom
 */
import "../../../../purchases/__tests__/text-encoder-polyfill"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom"

const mockFetch = jest.fn()
const mockVariantList = jest.fn()
const mockToastSuccess = jest.fn()

jest.mock("../../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
    admin: {
      productVariant: {
        list: (...args: unknown[]) => mockVariantList(...args),
      },
    },
  },
}))

jest.mock("@medusajs/ui", () => ({
  ...jest.requireActual("@medusajs/ui"),
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args) },
}))

import NewInvoicePage from "../page"

function DetailStub() {
  const { id } = useParams()
  return <div>Invoice detail {id}</div>
}

function renderPage(path = "/accounting/invoices/new") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounting/invoices/new" element={<NewInvoicePage />} />
          <Route path="/accounting/invoices/:id" element={<DetailStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type Row = Record<string, any>

// Fresh objects on every call (structuredClone is missing in jsdom).
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function purchaseItem(overrides: Row = {}) {
  return {
    id: "pi_1",
    variant_id: "var_1",
    sku: "S1",
    title: "Oud Royal - 100ml",
    quantity: 10,
    quantity_received: 4,
    remaining: 6,
    unit_cost: 12.5,
    ...overrides,
  }
}

function makePurchase(overrides: Row = {}) {
  return {
    id: "pur_1",
    reference: "PO-0001",
    status: "partially_received",
    supplier: { id: "sup_1", name: "Acme Perfumes" },
    items: [
      purchaseItem(),
      purchaseItem({
        id: "pi_2",
        variant_id: "var_2",
        title: "Amber Night - 50ml",
        quantity: 3,
        quantity_received: 3,
        unit_cost: 8,
      }),
    ],
    ...overrides,
  }
}

let purchases: Row[]
let invoices: Row[]
let supplierProducts: Row[]
let variantRows: Row[]
let postBodies: Row[]
let failPurchases: boolean
let postError: string | null

function installServer() {
  mockFetch.mockImplementation(
    (url: string, opts?: { query?: Row; method?: string; body?: Row }) => {
      const query = opts?.query ?? {}
      if (url === "/admin/purchases") {
        if (failPurchases) {
          return Promise.reject(new Error("boom"))
        }
        const rows = purchases.filter((p) => p.status === query.status)
        return Promise.resolve({
          purchases: clone(rows),
          count: rows.length,
        })
      }
      const detail = url.match(/^\/admin\/purchases\/(.+)$/)
      if (detail) {
        const found = purchases.find((p) => p.id === detail[1])
        return found
          ? Promise.resolve({ purchase: clone(found) })
          : Promise.reject(new Error("not found"))
      }
      if (url === "/admin/invoices" && opts?.method === "POST") {
        postBodies.push(clone(opts.body as Row))
        if (postError) {
          return Promise.reject(new Error(postError))
        }
        return Promise.resolve({ invoice: { id: "inv_new" } })
      }
      if (url === "/admin/invoices") {
        const rows = invoices.filter(
          (i) =>
            i.purchase_id === query.purchase_id && i.status === query.status
        )
        return Promise.resolve({
          invoices: clone(rows),
          count: rows.length,
        })
      }
      if (url === "/admin/suppliers/sup_1/products") {
        const q = String(query.q ?? "").toLowerCase()
        const rows = supplierProducts.filter((r) =>
          r.supplier_sku.toLowerCase().includes(q)
        )
        return Promise.resolve({
          supplier_products: clone(rows),
          count: rows.length,
        })
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    }
  )
  mockVariantList.mockImplementation(
    ({ q, limit }: { q?: string; limit: number }) => {
      const rows = variantRows.filter(
        (v) => !q || v.title.toLowerCase().includes(q.toLowerCase())
      )
      return Promise.resolve({
        variants: clone(rows.slice(0, limit)),
        count: rows.length,
        limit,
        offset: 0,
      })
    }
  )
}

function saveButton() {
  return screen.getByRole("button", { name: "Save" })
}

async function choosePurchase(value = "pur_1") {
  await screen.findByRole("option", { name: /PO-0001/ })
  fireEvent.change(screen.getByLabelText("Purchase"), { target: { value } })
  await screen.findByLabelText("Quantity for Oud Royal - 100ml")
}

function fillHeader(number = "SUP-100", date = "2026-10-05") {
  fireEvent.change(screen.getByLabelText("Invoice number"), {
    target: { value: number },
  })
  fireEvent.change(screen.getByLabelText("Invoice date"), {
    target: { value: date },
  })
}

function typeCode(code: string) {
  fireEvent.change(screen.getByLabelText("Supplier code"), {
    target: { value: code },
  })
  fireEvent.click(screen.getByRole("button", { name: "Add line" }))
}

describe("NewInvoicePage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    purchases = [makePurchase()]
    invoices = []
    supplierProducts = [
      {
        supplier_sku: "ACME-9",
        unit_cost: 7.25,
        variant_id: "var_9",
        variant: { title: "30ml", product: { title: "Rose Mist" } },
      },
    ]
    variantRows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      id: `var_x${n}`,
      title: `Cedar ${n}`,
      sku: `CED-${n}`,
      product: { title: "Cedar Wood" },
    }))
    postBodies = []
    failPurchases = false
    postError = null
    installServer()
  })

  it("prefills lines with the uninvoiced quantity and ordered cost, with live totals in plain dollars", async () => {
    invoices = [
      {
        purchase_id: "pur_1",
        status: "posted",
        items: [{ purchase_item_id: "pi_1", quantity: 4 }],
      },
      {
        purchase_id: "pur_1",
        status: "draft",
        items: [{ purchase_item_id: "pi_2", quantity: 3 }],
      },
    ]
    renderPage()
    await choosePurchase()

    expect(screen.getByLabelText("Quantity for Oud Royal - 100ml")).toHaveValue(6)
    expect(screen.getByLabelText("Unit cost for Oud Royal - 100ml")).toHaveValue(
      12.5
    )
    // pi_2 is fully invoiced and omitted.
    expect(screen.queryByLabelText("Quantity for Amber Night - 50ml")).toBeNull()
    expect(screen.getByTestId("subtotal")).toHaveTextContent("$75.00")
    expect(screen.getByTestId("total")).toHaveTextContent("$75.00")

    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "2" },
    })
    fireEvent.change(screen.getByLabelText("Unit cost for Oud Royal - 100ml"), {
      target: { value: "10.1" },
    })
    fireEvent.change(screen.getByLabelText("Shipping cost"), {
      target: { value: "3" },
    })
    expect(screen.getByTestId("subtotal")).toHaveTextContent("$20.20")
    expect(screen.getByTestId("total")).toHaveTextContent("$23.20")
  })

  it("removing a line drops it and its total", async () => {
    renderPage()
    await choosePurchase()
    expect(screen.getByTestId("subtotal")).toHaveTextContent("$149.00")
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Amber Night - 50ml" })
    )
    expect(screen.queryByLabelText("Quantity for Amber Night - 50ml")).toBeNull()
    expect(screen.getByTestId("subtotal")).toHaveTextContent("$125.00")
  })

  it("Save is disabled without number, date and a valid line", async () => {
    renderPage()
    await choosePurchase()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Invoice number"), {
      target: { value: "SUP-1" },
    })
    expect(saveButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Invoice date"), {
      target: { value: "2026-10-05" },
    })
    expect(saveButton()).toBeEnabled()

    for (const bad of ["", "abc", "1.5", "0", "-2"]) {
      fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
        target: { value: bad },
      })
      expect(saveButton()).toBeDisabled()
    }
    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "2" },
    })
    expect(saveButton()).toBeEnabled()

    fireEvent.change(screen.getByLabelText("Unit cost for Oud Royal - 100ml"), {
      target: { value: "-1" },
    })
    expect(saveButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Unit cost for Oud Royal - 100ml"), {
      target: { value: "0" },
    })
    expect(saveButton()).toBeEnabled()

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Oud Royal - 100ml" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Amber Night - 50ml" })
    )
    expect(saveButton()).toBeDisabled()
  })

  it("saves, toasts and navigates to the new invoice", async () => {
    renderPage()
    await choosePurchase()
    fillHeader(" SUP-100 ")
    fireEvent.change(screen.getByLabelText("Tax"), { target: { value: "2.5" } })
    fireEvent.click(saveButton())

    expect(await screen.findByText("Invoice detail inv_new")).toBeInTheDocument()
    expect(mockToastSuccess).toHaveBeenCalledWith("Invoice saved")
    expect(postBodies).toEqual([
      {
        purchase_id: "pur_1",
        invoice_number: "SUP-100",
        invoice_date: "2026-10-05",
        shipping_cost: 0,
        tax: 2.5,
        other_cost: 0,
        items: [
          {
            purchase_item_id: "pi_1",
            variant_id: "var_1",
            quantity: 10,
            unit_cost: 12.5,
          },
          {
            purchase_item_id: "pi_2",
            variant_id: "var_2",
            quantity: 3,
            unit_cost: 8,
          },
        ],
      },
    ])
  })

  it("shows a server error inline and keeps the form", async () => {
    postError = "Invoice number SUP-100 already exists for this supplier"
    renderPage()
    await choosePurchase()
    fillHeader()
    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "7" },
    })
    fireEvent.click(saveButton())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invoice number SUP-100 already exists for this supplier"
    )
    expect(screen.getByLabelText("Invoice number")).toHaveValue("SUP-100")
    expect(screen.getByLabelText("Quantity for Oud Royal - 100ml")).toHaveValue(7)
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(screen.queryByText(/Invoice detail/)).toBeNull()
  })

  it("preselects the purchase from ?purchase_id=", async () => {
    renderPage("/accounting/invoices/new?purchase_id=pur_1")
    expect(
      await screen.findByLabelText("Quantity for Oud Royal - 100ml")
    ).toHaveValue(10)
    expect(screen.getByLabelText("Purchase")).toHaveValue("pur_1")
  })

  it("filters purchases by reference and supplier name", async () => {
    purchases = [
      makePurchase(),
      makePurchase({
        id: "pur_2",
        reference: "PO-0002",
        status: "received",
        supplier: { id: "sup_2", name: "Oud House" },
      }),
    ]
    renderPage()
    await screen.findByRole("option", { name: /PO-0002/ })
    fireEvent.change(screen.getByLabelText("Find a purchase"), {
      target: { value: "oud house" },
    })
    expect(screen.queryByRole("option", { name: /PO-0001/ })).toBeNull()
    expect(screen.getByRole("option", { name: /PO-0002/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Find a purchase"), {
      target: { value: "po-0001" },
    })
    expect(screen.getByRole("option", { name: /PO-0001/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /PO-0002/ })).toBeNull()
  })

  it("shows Retry when the purchase list fails and recovers", async () => {
    failPurchases = true
    renderPage()
    expect(
      await screen.findByText("Something went wrong loading purchases.")
    ).toBeInTheDocument()
    failPurchases = false
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(
      await screen.findByRole("option", { name: /PO-0001/ })
    ).toBeInTheDocument()
  })

  it("a known code adds a line for its variant with the supplier cost, linked to the purchase item", async () => {
    supplierProducts = [
      {
        supplier_sku: "ACME-1",
        unit_cost: 11,
        variant_id: "var_1",
        variant: { title: "100ml", product: { title: "Oud Royal" } },
      },
    ]
    renderPage()
    await choosePurchase()
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Oud Royal - 100ml" })
    )
    typeCode("acme-1")

    expect(await screen.findByLabelText("Quantity for Oud Royal - 100ml"))
      .toHaveValue(1)
    expect(screen.getByLabelText("Unit cost for Oud Royal - 100ml")).toHaveValue(
      11
    )
    expect(screen.getByText("ACME-1")).toBeInTheDocument()
    expect(screen.queryByText("Not on purchase")).toBeNull()

    fillHeader()
    fireEvent.click(saveButton())
    await screen.findByText("Invoice detail inv_new")
    expect(postBodies[0].items).toContainEqual({
      purchase_item_id: "pi_1",
      variant_id: "var_1",
      supplier_sku: "ACME-1",
      quantity: 1,
      unit_cost: 11,
    })
  })

  it("a known code for a variant not on the purchase adds a Not on purchase line", async () => {
    renderPage()
    await choosePurchase()
    typeCode("ACME-9")
    expect(await screen.findByText("Not on purchase")).toBeInTheDocument()
    expect(screen.getByLabelText("Unit cost for Rose Mist - 30ml")).toHaveValue(
      7.25
    )
  })

  it("an unknown code shows a 5-product picker and an optional remember checkbox that reaches the POST body", async () => {
    renderPage()
    await choosePurchase()
    typeCode("NOPE-1")

    expect(
      await screen.findByText(/No product with the code "NOPE-1"/)
    ).toBeInTheDocument()
    await screen.findByText("Cedar Wood - Cedar 1 (CED-1)")
    expect(screen.getAllByRole("button", { name: /^Choose / })).toHaveLength(5)
    expect(screen.getByText(/Showing the first 5/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Remember this code for this supplier")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Choose Cedar Wood - Cedar 2 (CED-2)" })
    )
    const remember = await screen.findByLabelText(
      "Remember this code for this supplier"
    )
    expect(remember).not.toBeChecked()
    fireEvent.click(remember)
    fireEvent.click(screen.getByRole("button", { name: "Add to invoice" }))

    expect(await screen.findByText("Not on purchase")).toBeInTheDocument()
    expect(screen.getByText("NOPE-1")).toBeInTheDocument()

    fillHeader()
    fireEvent.click(saveButton())
    await screen.findByText("Invoice detail inv_new")
    expect(postBodies[0].items).toContainEqual({
      variant_id: "var_x2",
      supplier_sku: "NOPE-1",
      remember_code: true,
      quantity: 1,
      unit_cost: 0,
    })
  })

  it("does not send remember_code when the checkbox is left unticked", async () => {
    renderPage()
    await choosePurchase()
    typeCode("NOPE-1")
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Choose Cedar Wood - Cedar 3 (CED-3)",
      })
    )
    fireEvent.click(await screen.findByRole("button", { name: "Add to invoice" }))
    await screen.findByText("Not on purchase")
    fillHeader()
    fireEvent.click(saveButton())
    await screen.findByText("Invoice detail inv_new")
    const item = postBodies[0].items.find((i: Row) => i.variant_id === "var_x3")
    expect(item).toEqual({
      variant_id: "var_x3",
      supplier_sku: "NOPE-1",
      quantity: 1,
      unit_cost: 0,
    })
  })

  it("the product picker searches as you type and ignores stale responses", async () => {
    let resolveSlow: (value: unknown) => void = () => {}
    mockVariantList.mockImplementation(({ q }: { q?: string }) => {
      if (q === "NOPE-1") {
        return new Promise((resolve) => {
          resolveSlow = resolve
        })
      }
      return Promise.resolve({
        variants: [
          { id: "var_fast", title: "Fast result", sku: "F", product: null },
        ],
        count: 1,
        limit: 5,
        offset: 0,
      })
    })
    renderPage()
    await choosePurchase()
    typeCode("NOPE-1")
    await screen.findByLabelText("Search products")
    fireEvent.change(screen.getByLabelText("Search products"), {
      target: { value: "fast" },
    })
    expect(await screen.findByText("Fast result (F)")).toBeInTheDocument()

    await act(async () => {
      resolveSlow({
        variants: [{ id: "var_old", title: "Old result", sku: "O", product: null }],
        count: 1,
        limit: 5,
        offset: 0,
      })
    })
    expect(screen.queryByText("Old result (O)")).toBeNull()
    expect(screen.getByText("Fast result (F)")).toBeInTheDocument()
  })

  it("asks which purchase item when the variant is on the purchase twice", async () => {
    purchases = [
      makePurchase({
        items: [
          purchaseItem({ id: "pi_a", quantity: 2, unit_cost: 5 }),
          purchaseItem({ id: "pi_b", quantity: 4, unit_cost: 6 }),
        ],
      }),
    ]
    supplierProducts = [
      {
        supplier_sku: "ACME-1",
        unit_cost: null,
        variant_id: "var_1",
        variant: { title: "100ml", product: { title: "Oud Royal" } },
      },
    ]
    renderPage()
    await screen.findByRole("option", { name: /PO-0001/ })
    fireEvent.change(screen.getByLabelText("Purchase"), {
      target: { value: "pur_1" },
    })
    await screen.findAllByLabelText("Quantity for Oud Royal - 100ml")
    typeCode("ACME-1")

    const select = await screen.findByLabelText("Which purchase item?")
    expect(screen.getByRole("button", { name: "Add to invoice" })).toBeDisabled()
    fireEvent.change(select, { target: { value: "pi_b" } })
    fireEvent.click(screen.getByRole("button", { name: "Add to invoice" }))

    await waitFor(() =>
      expect(screen.getAllByLabelText("Quantity for Oud Royal - 100ml")).toHaveLength(3)
    )
    fillHeader()
    fireEvent.click(saveButton())
    await screen.findByText("Invoice detail inv_new")
    expect(postBodies[0].items[2]).toEqual({
      purchase_item_id: "pi_b",
      variant_id: "var_1",
      supplier_sku: "ACME-1",
      quantity: 1,
      unit_cost: 0,
    })
  })

  it("shows price and quantity warnings from local data without blocking Save", async () => {
    invoices = [
      {
        purchase_id: "pur_1",
        status: "posted",
        items: [{ purchase_item_id: "pi_1", quantity: 2 }],
      },
    ]
    renderPage()
    await choosePurchase()
    // Prefilled: 8 of 10 ordered, 4 received. Billing 8 + 2 already = 10.
    expect(screen.queryByText(/Billed above ordered/)).toBeNull()
    expect(screen.getByText("Billed above received (4)")).toBeInTheDocument()
    expect(screen.queryByText(/Price differs/)).toBeNull()

    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "9" },
    })
    fireEvent.change(screen.getByLabelText("Unit cost for Oud Royal - 100ml"), {
      target: { value: "13" },
    })
    expect(screen.getByText("Billed above ordered (10)")).toBeInTheDocument()
    expect(screen.getByText("Price differs from ordered $12.50")).toBeInTheDocument()

    fillHeader()
    expect(saveButton()).toBeEnabled()
  })

  it("does not reset typed values when the data refetches", async () => {
    renderPage()
    await choosePurchase()
    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "3" },
    })
    // Another window focus would refetch; a fresh server answer must not win.
    purchases = [makePurchase({ items: [purchaseItem({ quantity: 99 })] })]
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(screen.getByLabelText("Quantity for Oud Royal - 100ml")).toHaveValue(3)
  })

  it("does not look anything up before a code is submitted", async () => {
    renderPage()
    await choosePurchase()
    await act(async () => {})
    expect(
      mockFetch.mock.calls.filter(([url]) => String(url).endsWith("/products"))
    ).toHaveLength(0)
    expect(mockVariantList).not.toHaveBeenCalled()
  })
})
