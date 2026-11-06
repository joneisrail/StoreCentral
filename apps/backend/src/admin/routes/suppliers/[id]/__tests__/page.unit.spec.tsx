/**
 * @jest-environment jsdom
 */
import "../../../purchases/__tests__/text-encoder-polyfill"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"

const mockFetch = jest.fn()
const mockToast = { success: jest.fn(), error: jest.fn() }

jest.mock("../../../../lib/sdk", () => ({
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

// Radix Switch measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

import SupplierDetailPage from "../page"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/suppliers/sup_1"]}>
        <Routes>
          <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const supplier = {
  id: "sup_1",
  name: "Acme Perfumes",
  email: "sales@acme.test",
  phone: "+1 555 0100",
  address: "1 Main St",
  notes: "Reliable",
  contact_name: "Ann Lee",
  website: "https://acme.test",
  tax_id: "TX-9",
  payment_terms: "Net 30",
  lead_time_days: 14,
  is_active: true,
  created_at: "2026-10-01T00:00:00.000Z",
}

function postCalls() {
  return mockFetch.mock.calls.filter((c) => c[1]?.method === "POST")
}

describe("SupplierDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockResolvedValue({ supplier })
  })

  it("shows the tabs and every supplier field", async () => {
    renderPage()

    expect(await screen.findByLabelText("Name")).toHaveValue("Acme Perfumes")
    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Products" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Purchases" })).toBeInTheDocument()
    expect(screen.getByLabelText("Contact name")).toHaveValue("Ann Lee")
    expect(screen.getByLabelText("Email")).toHaveValue("sales@acme.test")
    expect(screen.getByLabelText("Phone")).toHaveValue("+1 555 0100")
    expect(screen.getByLabelText("Website")).toHaveValue("https://acme.test")
    expect(screen.getByLabelText("Tax ID")).toHaveValue("TX-9")
    expect(screen.getByLabelText("Payment terms")).toHaveValue("Net 30")
    expect(screen.getByLabelText("Lead time (days)")).toHaveValue(14)
    expect(screen.getByLabelText("Address")).toHaveValue("1 Main St")
    expect(screen.getByLabelText("Notes")).toHaveValue("Reliable")
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked()
    expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers/sup_1")
  })

  it("saves only the changed fields and shows a success toast", async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText("Phone"), {
      target: { value: "+1 555 9999" },
    })
    fireEvent.change(screen.getByLabelText("Lead time (days)"), {
      target: { value: "21" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers/sup_1", {
        method: "POST",
        body: { phone: "+1 555 9999", lead_time_days: 21 },
      })
    )
    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith("Supplier updated")
    )
  })

  it("clearing the website posts website: null", async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText("Website"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers/sup_1", {
        method: "POST",
        body: { website: null },
      })
    )
  })

  it("the active switch posts is_active", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("switch", { name: "Active" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers/sup_1", {
        method: "POST",
        body: { is_active: false },
      })
    )
    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith("Supplier updated")
    )
  })

  // Behaves like a server: POSTs merge into the stored supplier and every
  // response is a fresh object, so react-query sees real changes.
  function useStatefulServer() {
    let server = { ...supplier }
    mockFetch.mockImplementation(
      (_url: string, opts?: { method?: string; body?: object }) => {
        if (opts?.method === "POST") {
          server = { ...server, ...opts.body }
        }
        return Promise.resolve({ supplier: { ...server } })
      }
    )
  }

  it("toggling Active keeps unsaved text edits and a later Save posts only them", async () => {
    useStatefulServer()
    renderPage()
    const phone = await screen.findByLabelText("Phone")
    fireEvent.change(phone, { target: { value: "+1 555 7777" } })

    fireEvent.click(screen.getByRole("switch", { name: "Active" }))
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Active" })).not.toBeChecked()
    )
    expect(screen.getByLabelText("Phone")).toHaveValue("+1 555 7777")

    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(postCalls()).toHaveLength(2))
    expect(postCalls()[1][1].body).toEqual({ phone: "+1 555 7777" })
  })

  it("a second Save with no edits makes no second POST", async () => {
    useStatefulServer()
    renderPage()
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Acme Renamed" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled())
    // The heading only changes once the refetched supplier has rendered.
    expect(
      await screen.findByRole("heading", { name: "Acme Renamed" })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})

    expect(postCalls()).toHaveLength(1)
  })

  it("switching to another cached supplier shows its values", async () => {
    const other = { ...supplier, id: "sup_2", name: "Globex Oils", phone: "+1 555 0200" }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(["admin", "suppliers", "detail", "sup_2"], {
      supplier: other,
    })
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({ supplier: url.endsWith("sup_2") ? other : supplier })
    )
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/suppliers/sup_1"]}>
          <Link to="/suppliers/sup_2">go</Link>
          <Routes>
            <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(await screen.findByLabelText("Name")).toHaveValue("Acme Perfumes")

    fireEvent.click(screen.getByText("go"))

    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("Globex Oils")
    )
    expect(screen.getByLabelText("Phone")).toHaveValue("+1 555 0200")
  })

  it("does not post when nothing changed", async () => {
    renderPage()
    await screen.findByLabelText("Name")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(postCalls()).toHaveLength(0)
  })

  it("shows the error message when saving fails", async () => {
    mockFetch.mockImplementation((_url: string, opts?: { method?: string }) =>
      opts?.method === "POST"
        ? Promise.reject(new Error("Invalid email"))
        : Promise.resolve({ supplier })
    )
    renderPage()
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "bad" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Invalid email")).toBeInTheDocument()
    expect(mockToast.error).toHaveBeenCalledWith("Invalid email")
  })

  it('shows "Supplier not found" on a 404', async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 })
    )
    renderPage()

    expect(await screen.findByText("Supplier not found")).toBeInTheDocument()
  })
})
