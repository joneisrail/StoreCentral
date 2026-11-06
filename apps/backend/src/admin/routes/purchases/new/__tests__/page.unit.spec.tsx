/**
 * @jest-environment jsdom
 */
import "../../__tests__/text-encoder-polyfill"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom"

const mockFetch = jest.fn()
const mockVariantList = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
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

import NewPurchasePage from "../page"

function DetailStub() {
  const { id } = useParams()
  return <div>Detail page {id}</div>
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/purchases/new"]}>
        <Routes>
          <Route path="/purchases/new" element={<NewPurchasePage />} />
          <Route path="/purchases/:id" element={<DetailStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const suppliers = [
  { id: "sup_1", name: "Acme Perfumes" },
  { id: "sup_2", name: "Oud House" },
]

const variants = [
  {
    id: "variant_1",
    title: "100ml",
    sku: "SKU-100",
    product: { title: "Oud Royal" },
  },
  {
    id: "variant_2",
    title: "50ml",
    sku: "SKU-50",
    product: { title: "Amber Night" },
  },
]

function suppliersResponse() {
  return { suppliers, count: 2, limit: 100, offset: 0 }
}

function productsResponse(rows: Array<Record<string, unknown>>) {
  return {
    supplier_products: rows,
    count: rows.length,
    offset: 0,
    limit: 50,
  }
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sp_1",
    supplier_id: "sup_1",
    variant_id: "variant_1",
    supplier_sku: "ACME-001",
    supplier_title: "Oud",
    unit_cost: 12.5,
    ...overrides,
  }
}

function productCalls() {
  return mockFetch.mock.calls.filter(([path]) =>
    String(path).endsWith("/products")
  )
}

async function pickSupplier() {
  await screen.findByRole("option", { name: "Acme Perfumes" })
  fireEvent.change(screen.getByLabelText("Supplier"), {
    target: { value: "sup_1" },
  })
}

async function searchAndAdd(query: string, label: string) {
  fireEvent.change(screen.getByPlaceholderText("Search variants"), {
    target: { value: query },
  })
  fireEvent.click(screen.getByRole("button", { name: "Search" }))
  fireEvent.click(await screen.findByRole("button", { name: `Add ${label}` }))
}

function saveButton() {
  return screen.getByRole("button", { name: "Save" })
}

describe("NewPurchasePage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockImplementation((path: string) => {
      if (path === "/admin/suppliers") {
        return Promise.resolve(suppliersResponse())
      }
      if (path.endsWith("/products")) {
        return Promise.resolve(productsResponse([]))
      }
      return Promise.resolve({ purchase: { id: "pur_new" } })
    })
    mockVariantList.mockResolvedValue({
      variants,
      count: 2,
      limit: 10,
      offset: 0,
    })
  })

  it("Save is disabled until a supplier and at least one item with quantity above 0 are set", async () => {
    renderPage()
    expect(saveButton()).toBeDisabled()

    await pickSupplier()
    expect(saveButton()).toBeDisabled()

    await searchAndAdd("oud", "Oud Royal - 100ml (SKU-100)")
    expect(saveButton()).toBeEnabled()

    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "0" },
    })
    expect(saveButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "2" },
    })
    expect(saveButton()).toBeEnabled()
  })

  it("searching variants shows results and adding one creates an item row with quantity and unit cost inputs", async () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText("Search variants"), {
      target: { value: "oud" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Search" }))

    expect(
      await screen.findByText("Oud Royal - 100ml (SKU-100)")
    ).toBeInTheDocument()
    expect(screen.getByText("Amber Night - 50ml (SKU-50)")).toBeInTheDocument()
    expect(mockVariantList).toHaveBeenCalledWith({
      q: "oud",
      limit: 10,
      fields: "id,title,sku,product.title",
    })
    expect(screen.queryByLabelText("Quantity for Oud Royal - 100ml")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Add Oud Royal - 100ml (SKU-100)" })
    )

    expect(screen.getByLabelText("Quantity for Oud Royal - 100ml")).toHaveValue(
      1
    )
    expect(
      screen.getByLabelText("Unit cost for Oud Royal - 100ml")
    ).toHaveValue(0)
    expect(screen.queryByLabelText("Quantity for Amber Night - 50ml")).toBeNull()
  })

  it("removing a row works", async () => {
    renderPage()
    await searchAndAdd("oud", "Oud Royal - 100ml (SKU-100)")
    expect(
      screen.getByLabelText("Quantity for Oud Royal - 100ml")
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Oud Royal - 100ml" })
    )

    expect(screen.queryByLabelText("Quantity for Oud Royal - 100ml")).toBeNull()
    expect(screen.getByText("No items added yet.")).toBeInTheDocument()
  })

  it("shows live subtotal and total including shipping, tax and other cost", async () => {
    renderPage()
    await searchAndAdd("a", "Oud Royal - 100ml (SKU-100)")
    await searchAndAdd("a", "Amber Night - 50ml (SKU-50)")

    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "2" },
    })
    fireEvent.change(
      screen.getByLabelText("Unit cost for Oud Royal - 100ml"),
      { target: { value: "10.25" } }
    )
    fireEvent.change(screen.getByLabelText("Quantity for Amber Night - 50ml"), {
      target: { value: "3" },
    })
    fireEvent.change(
      screen.getByLabelText("Unit cost for Amber Night - 50ml"),
      { target: { value: "4" } }
    )

    expect(screen.getByTestId("subtotal")).toHaveTextContent("$32.50")
    expect(screen.getByTestId("total")).toHaveTextContent("$32.50")

    fireEvent.change(screen.getByLabelText("Shipping cost"), {
      target: { value: "5" },
    })
    fireEvent.change(screen.getByLabelText("Tax"), {
      target: { value: "2.5" },
    })
    fireEvent.change(screen.getByLabelText("Other cost"), {
      target: { value: "1.25" },
    })

    expect(screen.getByTestId("subtotal")).toHaveTextContent("$32.50")
    expect(screen.getByTestId("total")).toHaveTextContent("$41.25")
  })

  it("Save posts { supplier_id, items, shipping_cost, tax, other_cost, notes } and navigates to the new purchase", async () => {
    renderPage()
    await pickSupplier()
    await searchAndAdd("oud", "Oud Royal - 100ml (SKU-100)")
    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "2" },
    })
    fireEvent.change(
      screen.getByLabelText("Unit cost for Oud Royal - 100ml"),
      { target: { value: "10.25" } }
    )
    fireEvent.change(screen.getByLabelText("Shipping cost"), {
      target: { value: "5" },
    })
    fireEvent.change(screen.getByLabelText("Tax"), {
      target: { value: "2.5" },
    })
    fireEvent.change(screen.getByLabelText("Other cost"), {
      target: { value: "1.25" },
    })
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "First order" },
    })

    fireEvent.click(saveButton())

    expect(await screen.findByText("Detail page pur_new")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/admin/purchases", {
      method: "POST",
      body: {
        supplier_id: "sup_1",
        items: [{ variant_id: "variant_1", quantity: 2, unit_cost: 10.25 }],
        shipping_cost: 5,
        tax: 2.5,
        other_cost: 1.25,
        notes: "First order",
      },
    })
  })

  it("a server error is shown and the form keeps its values", async () => {
    mockFetch.mockImplementation((path: string) =>
      path === "/admin/suppliers"
        ? Promise.resolve(suppliersResponse())
        : Promise.reject(new Error("Variant not found"))
    )
    renderPage()
    await pickSupplier()
    await searchAndAdd("oud", "Oud Royal - 100ml (SKU-100)")
    fireEvent.change(screen.getByLabelText("Quantity for Oud Royal - 100ml"), {
      target: { value: "4" },
    })
    fireEvent.change(screen.getByLabelText("Shipping cost"), {
      target: { value: "5" },
    })
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Keep me" },
    })

    fireEvent.click(saveButton())

    expect(await screen.findByText("Variant not found")).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.queryByText(/Detail page/)).toBeNull()
    expect(screen.getByLabelText("Supplier")).toHaveValue("sup_1")
    expect(screen.getByLabelText("Quantity for Oud Royal - 100ml")).toHaveValue(
      4
    )
    expect(screen.getByLabelText("Shipping cost")).toHaveValue(5)
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep me")
  })

  describe("supplier options and cost prefill", () => {
    const OUD = "Oud Royal - 100ml (SKU-100)"
    const costInput = () => screen.getByLabelText("Unit cost for Oud Royal - 100ml")

    it("requests only active suppliers", async () => {
      renderPage()
      await screen.findByRole("option", { name: "Acme Perfumes" })
      expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers", {
        query: { limit: 100, is_active: true },
      })
    })

    it("prefills the cost and shows the supplier code when the variant has an entry with a cost", async () => {
      mockFetch.mockImplementation((path: string) => {
        if (path === "/admin/suppliers") {
          return Promise.resolve(suppliersResponse())
        }
        return Promise.resolve(productsResponse([productRow()]))
      })
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)

      await waitFor(() => expect(costInput()).toHaveValue(12.5))
      expect(screen.getByText("ACME-001")).toBeInTheDocument()
      expect(mockFetch).toHaveBeenCalledWith(
        "/admin/suppliers/sup_1/products",
        { query: { variant_id: "variant_1" } }
      )
      expect(screen.getByTestId("subtotal")).toHaveTextContent("$12.50")
    })

    it("leaves the cost alone when the entry has no cost, but still shows the code", async () => {
      mockFetch.mockImplementation((path: string) => {
        if (path === "/admin/suppliers") {
          return Promise.resolve(suppliersResponse())
        }
        return Promise.resolve(
          productsResponse([productRow({ unit_cost: null })])
        )
      })
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)

      expect(await screen.findByText("ACME-001")).toBeInTheDocument()
      expect(costInput()).toHaveValue(0)
    })

    it("leaves the cost alone when the variant has no entry", async () => {
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)

      await waitFor(() => expect(productCalls()).toHaveLength(1))
      await waitFor(() => expect(screen.queryByText("ACME-001")).toBeNull())
      expect(costInput()).toHaveValue(0)
    })

    it("does not look anything up when no supplier is selected", async () => {
      renderPage()
      await screen.findByRole("option", { name: "Acme Perfumes" })
      await searchAndAdd("oud", OUD)

      expect(costInput()).toHaveValue(0)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(productCalls()).toHaveLength(0)
    })

    it("lets the admin overwrite a prefilled cost", async () => {
      mockFetch.mockImplementation((path: string) => {
        if (path === "/admin/suppliers") {
          return Promise.resolve(suppliersResponse())
        }
        return Promise.resolve(productsResponse([productRow()]))
      })
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)
      await waitFor(() => expect(costInput()).toHaveValue(12.5))

      fireEvent.change(costInput(), { target: { value: "9" } })
      expect(costInput()).toHaveValue(9)
      expect(screen.getByTestId("subtotal")).toHaveTextContent("$9.00")
    })

    it("does not overwrite a cost typed before the lookup answered", async () => {
      let resolveLookup: (value: unknown) => void = () => {}
      mockFetch.mockImplementation((path: string) => {
        if (path === "/admin/suppliers") {
          return Promise.resolve(suppliersResponse())
        }
        return new Promise((resolve) => {
          resolveLookup = resolve
        })
      })
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)
      fireEvent.change(costInput(), { target: { value: "7" } })

      resolveLookup(productsResponse([productRow()]))

      expect(await screen.findByText("ACME-001")).toBeInTheDocument()
      expect(costInput()).toHaveValue(7)
    })

    it("does not rewrite existing costs when the supplier changes afterwards", async () => {
      mockFetch.mockImplementation((path: string) => {
        if (path === "/admin/suppliers") {
          return Promise.resolve(suppliersResponse())
        }
        return Promise.resolve(productsResponse([productRow()]))
      })
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)
      await waitFor(() => expect(costInput()).toHaveValue(12.5))
      expect(productCalls()).toHaveLength(1)

      fireEvent.change(screen.getByLabelText("Supplier"), {
        target: { value: "sup_2" },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(productCalls()).toHaveLength(1)
      expect(costInput()).toHaveValue(12.5)
      expect(screen.getByText("ACME-001")).toBeInTheDocument()
    })

    it("a failed lookup does not block adding the item", async () => {
      mockFetch.mockImplementation((path: string) => {
        if (path === "/admin/suppliers") {
          return Promise.resolve(suppliersResponse())
        }
        return Promise.reject(new Error("boom"))
      })
      renderPage()
      await pickSupplier()
      await searchAndAdd("oud", OUD)

      await waitFor(() => expect(productCalls()).toHaveLength(1))
      expect(costInput()).toHaveValue(0)
      expect(saveButton()).toBeEnabled()
      expect(screen.queryByText("boom")).toBeNull()
    })
  })
})
