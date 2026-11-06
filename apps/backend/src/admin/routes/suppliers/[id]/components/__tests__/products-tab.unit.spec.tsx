/**
 * @jest-environment jsdom
 */
import "../../../../purchases/__tests__/text-encoder-polyfill"
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const mockFetch = jest.fn()
const mockVariantList = jest.fn()

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

import { ProductsTab } from "../products-tab"
import type { SupplierProductRow } from "../../../types"

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductsTab supplierId="sup_1" />
    </QueryClientProvider>
  )
}

const oud: SupplierProductRow = {
  id: "sp_1",
  supplier_id: "sup_1",
  variant_id: "variant_1",
  supplier_sku: "AC-OUD-100",
  supplier_title: "Acme Oud 100ml",
  unit_cost: 12.5,
  notes: null,
  variant: {
    id: "variant_1",
    title: "100ml",
    sku: "SKU-100",
    product: { id: "prod_1", title: "Oud Royal" },
  },
}

const orphan: SupplierProductRow = {
  id: "sp_2",
  supplier_id: "sup_1",
  variant_id: "variant_gone",
  supplier_sku: "AC-GONE",
  supplier_title: null,
  unit_cost: null,
  notes: null,
  variant: null,
}

const searchResults = [
  {
    id: "variant_2",
    title: "50ml",
    sku: "SKU-50",
    product: { title: "Amber Night" },
  },
]

type FetchOpts = {
  method?: string
  body?: Record<string, unknown>
  query?: { q?: string }
}

// Behaves like a server: list responses reflect the stored rows (fresh objects
// every time), writes mutate them.
function useStatefulServer(
  initial: SupplierProductRow[],
  options: { createError?: string } = {}
) {
  let rows = initial.map((r) => ({ ...r }))
  mockFetch.mockImplementation((url: string, opts: FetchOpts = {}) => {
    const itemMatch = url.match(/\/products\/([^/]+)$/)
    if (opts.method === "DELETE" && itemMatch) {
      rows = rows.filter((r) => r.id !== itemMatch[1])
      return Promise.resolve({
        id: itemMatch[1],
        object: "supplier_product",
        deleted: true,
      })
    }
    if (opts.method === "POST" && itemMatch) {
      rows = rows.map((r) =>
        r.id === itemMatch[1] ? { ...r, ...opts.body } : r
      )
      return Promise.resolve({
        supplier_product: { ...rows.find((r) => r.id === itemMatch[1]) },
      })
    }
    if (opts.method === "POST") {
      if (options.createError) {
        return Promise.reject(new Error(options.createError))
      }
      const created = {
        id: "sp_new",
        supplier_id: "sup_1",
        supplier_title: null,
        unit_cost: null,
        notes: null,
        ...opts.body,
        variant: {
          id: "variant_2",
          title: "50ml",
          sku: "SKU-50",
          product: { id: "prod_2", title: "Amber Night" },
        },
      } as SupplierProductRow
      rows = [created, ...rows]
      return Promise.resolve({ supplier_product: { ...created } })
    }
    const q = opts.query?.q?.toLowerCase()
    const matched = q
      ? rows.filter((r) => r.supplier_sku.toLowerCase().includes(q))
      : rows
    return Promise.resolve({
      supplier_products: matched.map((r) => ({ ...r })),
      count: matched.length,
      limit: 20,
      offset: 0,
    })
  })
}

function writeCalls() {
  return mockFetch.mock.calls.filter(
    (c) => c[1]?.method === "POST" || c[1]?.method === "DELETE"
  )
}

async function openAddDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Add product" }))
  return screen.findByRole("dialog")
}

async function pickVariant(dialog: HTMLElement) {
  fireEvent.click(
    await within(dialog).findByRole("button", {
      name: "Select Amber Night - 50ml (SKU-50)",
    })
  )
}

describe("ProductsTab", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVariantList.mockImplementation(() =>
      Promise.resolve({ variants: searchResults.map((v) => ({ ...v })) })
    )
  })

  it("lists supplier code, name, our product/variant, SKU and cost", async () => {
    useStatefulServer([oud])
    renderTab()

    expect(await screen.findByText("AC-OUD-100")).toBeInTheDocument()
    expect(screen.getByText("Acme Oud 100ml")).toBeInTheDocument()
    expect(screen.getByText("Oud Royal - 100ml")).toBeInTheDocument()
    expect(screen.getByText("SKU-100")).toBeInTheDocument()
    expect(screen.getByText("12.50")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(
      "/admin/suppliers/sup_1/products",
      expect.objectContaining({ query: expect.objectContaining({ limit: 20 }) })
    )
  })

  it('shows "Product removed from catalog" when the variant is gone', async () => {
    useStatefulServer([orphan])
    renderTab()

    expect(await screen.findByText("AC-GONE")).toBeInTheDocument()
    expect(screen.getByText("Product removed from catalog")).toBeInTheDocument()
  })

  it('the search box sends q and shows "No products found" when empty', async () => {
    useStatefulServer([oud])
    renderTab()
    await screen.findByText("AC-OUD-100")

    fireEvent.change(screen.getByPlaceholderText("Search products"), {
      target: { value: "zzz" },
    })

    expect(await screen.findByText("No products found")).toBeInTheDocument()
    expect(screen.queryByText("AC-OUD-100")).not.toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(
      "/admin/suppliers/sup_1/products",
      expect.objectContaining({
        query: expect.objectContaining({ q: "zzz" }),
      })
    )
  })

  it("adds a product: picks a variant, requires a code, posts and refreshes", async () => {
    useStatefulServer([oud])
    renderTab()
    const dialog = await openAddDialog()

    await pickVariant(dialog)
    expect(mockVariantList).toHaveBeenCalledWith({
      limit: 10,
      fields: "id,title,sku,product.title",
    })

    // No code yet: nothing is posted.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(
      await within(dialog).findByText("Supplier code is required.")
    ).toBeInTheDocument()
    await act(async () => {})
    expect(writeCalls()).toHaveLength(0)

    fireEvent.change(within(dialog).getByLabelText("Supplier code"), {
      target: { value: "AC-AMB-50" },
    })
    fireEvent.change(within(dialog).getByLabelText("Supplier product name"), {
      target: { value: "Acme Amber 50ml" },
    })
    fireEvent.change(within(dialog).getByLabelText("Unit cost"), {
      target: { value: "8.25" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/admin/suppliers/sup_1/products",
        {
          method: "POST",
          body: {
            variant_id: "variant_2",
            supplier_sku: "AC-AMB-50",
            supplier_title: "Acme Amber 50ml",
            unit_cost: 8.25,
          },
        }
      )
    )
    // The refreshed list shows the new row once the dialog has closed.
    expect(await screen.findByText("AC-AMB-50")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })

  it("omits optional fields that were left blank", async () => {
    useStatefulServer([])
    renderTab()
    const dialog = await openAddDialog()
    await pickVariant(dialog)
    fireEvent.change(within(dialog).getByLabelText("Supplier code"), {
      target: { value: "AC-AMB-50" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(writeCalls()).toHaveLength(1))
    expect(writeCalls()[0][1].body).toEqual({
      variant_id: "variant_2",
      supplier_sku: "AC-AMB-50",
    })
  })

  it("requires a variant to be picked", async () => {
    useStatefulServer([])
    renderTab()
    const dialog = await openAddDialog()
    fireEvent.change(within(dialog).getByLabelText("Supplier code"), {
      target: { value: "AC-1" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    expect(
      await within(dialog).findByText(
        "Select a product from the list above first."
      )
    ).toBeInTheDocument()
    await act(async () => {})
    expect(writeCalls()).toHaveLength(0)
  })

  it("shows the initial variants on open without searching or a q argument", async () => {
    useStatefulServer([])
    renderTab()
    const dialog = await openAddDialog()

    expect(
      await within(dialog).findByText("Amber Night - 50ml (SKU-50)")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        "Search and select the product you want to link, then enter the supplier's code."
      )
    ).toBeInTheDocument()
    expect(mockVariantList).toHaveBeenCalledTimes(1)
    expect(mockVariantList).toHaveBeenCalledWith({
      limit: 10,
      fields: "id,title,sku,product.title",
    })
    expect(mockVariantList.mock.calls[0][0]).not.toHaveProperty("q")
  })

  it("narrows the list after the debounce and sends q", async () => {
    useStatefulServer([])
    mockVariantList.mockImplementation((args: { q?: string }) =>
      Promise.resolve({
        variants: args.q
          ? [
              {
                id: "variant_9",
                title: "9ml",
                sku: "SKU-9",
                product: { title: "Zed" },
              },
            ]
          : searchResults.map((v) => ({ ...v })),
      })
    )
    renderTab()
    const dialog = await openAddDialog()
    await within(dialog).findByText("Amber Night - 50ml (SKU-50)")

    fireEvent.change(within(dialog).getByPlaceholderText("Search variants"), {
      target: { value: "zed" },
    })
    // Not yet: the debounce has not elapsed.
    expect(mockVariantList).toHaveBeenCalledTimes(1)

    expect(
      await within(dialog).findByText("Zed - 9ml (SKU-9)")
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByText("Amber Night - 50ml (SKU-50)")
    ).not.toBeInTheDocument()
    expect(mockVariantList).toHaveBeenLastCalledWith({
      q: "zed",
      limit: 10,
      fields: "id,title,sku,product.title",
    })
  })

  it("clicking a variant name selects it and Save posts that variant_id", async () => {
    useStatefulServer([])
    renderTab()
    const dialog = await openAddDialog()

    fireEvent.click(
      await within(dialog).findByText("Amber Night - 50ml (SKU-50)")
    )
    expect(
      await within(dialog).findByText("Linking to: Amber Night - 50ml (SKU-50)")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: /^Select/ })
    ).toHaveTextContent("Selected")
    fireEvent.change(within(dialog).getByLabelText("Supplier code"), {
      target: { value: "AC-AMB-50" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(writeCalls()).toHaveLength(1))
    expect(writeCalls()[0][1].body).toEqual({
      variant_id: "variant_2",
      supplier_sku: "AC-AMB-50",
    })
  })

  it("does not render undefined for variants with null titles", async () => {
    useStatefulServer([])
    mockVariantList.mockImplementation(() =>
      Promise.resolve({
        variants: [{ id: "v_x", title: null, sku: null, product: null }],
      })
    )
    renderTab()
    const dialog = await openAddDialog()
    expect(
      await within(dialog).findByText("Untitled variant (no SKU)")
    ).toBeInTheDocument()
  })

  it("a stale slower response does not replace the newer result", async () => {
    useStatefulServer([])
    let resolveInitial: (v: unknown) => void = () => {}
    mockVariantList.mockImplementation((args: { q?: string }) =>
      args.q
        ? Promise.resolve({
            variants: [
              {
                id: "v_new",
                title: "N",
                sku: "S-N",
                product: { title: "Newer" },
              },
            ],
          })
        : new Promise((resolve) => {
            resolveInitial = resolve
          })
    )
    renderTab()
    const dialog = await openAddDialog()

    fireEvent.change(within(dialog).getByPlaceholderText("Search variants"), {
      target: { value: "new" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Search" }))
    expect(
      await within(dialog).findByText("Newer - N (S-N)")
    ).toBeInTheDocument()

    await act(async () => {
      resolveInitial({
        variants: [
          { id: "v_old", title: "O", sku: "S-O", product: { title: "Older" } },
        ],
      })
    })
    expect(within(dialog).getByText("Newer - N (S-N)")).toBeInTheDocument()
    expect(
      within(dialog).queryByText("Older - O (S-O)")
    ).not.toBeInTheDocument()
  })

  it("shows a server 400 (duplicate code) inside the dialog", async () => {
    useStatefulServer([oud], {
      createError: "Supplier code AC-OUD-100 is already used",
    })
    renderTab()
    const dialog = await openAddDialog()
    await pickVariant(dialog)
    fireEvent.change(within(dialog).getByLabelText("Supplier code"), {
      target: { value: "AC-OUD-100" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    expect(
      await within(dialog).findByText(
        "Supplier code AC-OUD-100 is already used"
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("edits code, name and cost and refreshes the list", async () => {
    useStatefulServer([oud])
    renderTab()
    await screen.findByText("AC-OUD-100")

    fireEvent.click(screen.getByRole("button", { name: "Edit AC-OUD-100" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("Supplier code")).toHaveValue(
      "AC-OUD-100"
    )
    fireEvent.change(within(dialog).getByLabelText("Supplier code"), {
      target: { value: "AC-OUD-NEW" },
    })
    fireEvent.change(within(dialog).getByLabelText("Supplier product name"), {
      target: { value: "" },
    })
    fireEvent.change(within(dialog).getByLabelText("Unit cost"), {
      target: { value: "15" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/admin/suppliers/sup_1/products/sp_1",
        {
          method: "POST",
          body: {
            supplier_sku: "AC-OUD-NEW",
            supplier_title: null,
            unit_cost: 15,
          },
        }
      )
    )
    expect(await screen.findByText("AC-OUD-NEW")).toBeInTheDocument()
    expect(screen.queryByText("AC-OUD-100")).not.toBeInTheDocument()
    expect(screen.getByText("15.00")).toBeInTheDocument()
  })

  it("unlink asks for confirmation, then deletes and refreshes", async () => {
    useStatefulServer([oud, orphan])
    renderTab()
    await screen.findByText("AC-OUD-100")

    fireEvent.click(screen.getByRole("button", { name: "Unlink AC-OUD-100" }))
    const confirm = await screen.findByRole("alertdialog")
    await act(async () => {})
    expect(writeCalls()).toHaveLength(0)

    fireEvent.click(within(confirm).getByRole("button", { name: "Unlink" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/admin/suppliers/sup_1/products/sp_1",
        { method: "DELETE" }
      )
    )
    await waitFor(() =>
      expect(screen.queryByText("AC-OUD-100")).not.toBeInTheDocument()
    )
    expect(screen.getByText("AC-GONE")).toBeInTheDocument()
  })

  it("cancelling the unlink confirmation deletes nothing", async () => {
    useStatefulServer([oud])
    renderTab()
    await screen.findByText("AC-OUD-100")

    fireEvent.click(screen.getByRole("button", { name: "Unlink AC-OUD-100" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    await act(async () => {})

    expect(writeCalls()).toHaveLength(0)
    expect(screen.getByText("AC-OUD-100")).toBeInTheDocument()
  })
})
