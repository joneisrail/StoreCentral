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
    mockFetch.mockImplementation((path: string) =>
      path === "/admin/suppliers"
        ? Promise.resolve(suppliersResponse())
        : Promise.resolve({ purchase: { id: "pur_new" } })
    )
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
})
