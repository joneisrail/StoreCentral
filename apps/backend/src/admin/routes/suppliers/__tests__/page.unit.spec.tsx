/**
 * @jest-environment jsdom
 */
import "../../purchases/__tests__/text-encoder-polyfill"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import SuppliersPage from "../page"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SuppliersPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const acme = {
  id: "sup_1",
  name: "Acme Perfumes",
  email: "sales@acme.test",
  phone: "+1 555 0100",
  address: "1 Main St",
  notes: null,
  is_active: true,
  created_at: "2026-10-01T00:00:00.000Z",
}

const globex = {
  id: "sup_2",
  name: "Globex Oils",
  email: "hello@globex.test",
  phone: "+1 555 0200",
  address: null,
  notes: null,
  is_active: false,
  created_at: "2026-10-02T00:00:00.000Z",
}

function listResponse(suppliers: unknown[], count?: number) {
  return { suppliers, count: count ?? suppliers.length, offset: 0, limit: 20 }
}

function lastListCall() {
  const calls = mockFetch.mock.calls.filter(
    (c) => c[0] === "/admin/suppliers" && c[1]?.query
  )
  return calls[calls.length - 1]
}

describe("SuppliersPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("lists supplier names, emails and phones", async () => {
    mockFetch.mockResolvedValue(listResponse([acme, globex]))

    renderPage()

    expect(await screen.findByText("Acme Perfumes")).toBeInTheDocument()
    expect(screen.getByText("sales@acme.test")).toBeInTheDocument()
    expect(screen.getByText("+1 555 0100")).toBeInTheDocument()
    expect(screen.getByText("Globex Oils")).toBeInTheDocument()
    expect(screen.getByText("hello@globex.test")).toBeInTheDocument()
    expect(screen.getByText("+1 555 0200")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers", {
      query: { limit: 20, offset: 0 },
    })
  })

  it('shows "No suppliers yet." when empty', async () => {
    mockFetch.mockResolvedValue(listResponse([], 0))

    renderPage()

    expect(await screen.findByText("No suppliers yet.")).toBeInTheDocument()
  })

  it("shows an error with Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    mockFetch.mockResolvedValue(listResponse([acme]))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Acme Perfumes")).toBeInTheDocument()
  })

  it("typing in search refetches with q", async () => {
    mockFetch.mockResolvedValue(listResponse([acme]))

    renderPage()
    await screen.findByText("Acme Perfumes")

    fireEvent.change(screen.getByPlaceholderText("Search suppliers"), {
      target: { value: "acme" },
    })

    await waitFor(() =>
      expect(lastListCall()[1].query).toEqual({ limit: 20, offset: 0, q: "acme" })
    )
  })

  it("creating a supplier posts the entered fields and shows the new row", async () => {
    let suppliers: unknown[] = [acme]
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/admin/suppliers" && opts?.method === "POST") {
        suppliers = [...suppliers, globex]
        return Promise.resolve({ supplier: globex })
      }
      return Promise.resolve(listResponse(suppliers))
    })

    renderPage()
    await screen.findByText("Acme Perfumes")

    fireEvent.click(screen.getByRole("button", { name: "Create supplier" }))
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Globex Oils" },
    })
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "hello@globex.test" },
    })
    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "+1 555 0200" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers", {
        method: "POST",
        body: {
          name: "Globex Oils",
          email: "hello@globex.test",
          phone: "+1 555 0200",
        },
      })
    )
    expect(await screen.findByText("Globex Oils")).toBeInTheDocument()
  })

  it("rows link to the supplier detail page", async () => {
    mockFetch.mockResolvedValue(listResponse([acme]))

    renderPage()

    const link = await screen.findByRole("link", { name: "Acme Perfumes" })
    expect(link).toHaveAttribute("href", "/suppliers/sup_1")
  })

  it("the status select adds is_active to the request", async () => {
    mockFetch.mockResolvedValue(listResponse([acme]))

    renderPage()
    await screen.findByText("Acme Perfumes")

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "false" },
    })
    await waitFor(() =>
      expect(lastListCall()[1].query).toEqual({
        limit: 20,
        offset: 0,
        is_active: "false",
      })
    )

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "true" },
    })
    await waitFor(() =>
      expect(lastListCall()[1].query).toMatchObject({ is_active: "true" })
    )

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "all" },
    })
    await waitFor(() =>
      expect(lastListCall()[1].query).toEqual({ limit: 20, offset: 0 })
    )
  })

  it("marks inactive suppliers with an Inactive badge", async () => {
    mockFetch.mockResolvedValue(listResponse([acme, globex]))

    renderPage()
    await screen.findByText("Globex Oils")

    const table = screen.getByRole("table")
    expect(within(table).getAllByText("Inactive")).toHaveLength(1)
  })

  it("has no edit action any more", async () => {
    mockFetch.mockResolvedValue(listResponse([acme]))

    renderPage()
    await screen.findByText("Acme Perfumes")

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
  })

  it("deleting asks for confirmation and removes the row", async () => {
    let suppliers: unknown[] = [acme, globex]
    mockFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") {
        suppliers = suppliers.filter((s) => (s as { id: string }).id !== "sup_1")
        return Promise.resolve({ id: "sup_1", object: "supplier", deleted: true })
      }
      return Promise.resolve(listResponse(suppliers))
    })

    renderPage()
    await screen.findByText("Acme Perfumes")

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0])

    const dialog = await screen.findByRole("alertdialog")
    expect(mockFetch).not.toHaveBeenCalledWith(
      "/admin/suppliers/sup_1",
      expect.anything()
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers/sup_1", {
        method: "DELETE",
      })
    )
    await waitFor(() =>
      expect(screen.queryByText("Acme Perfumes")).not.toBeInTheDocument()
    )
    expect(screen.getByText("Globex Oils")).toBeInTheDocument()
  })

  it("a refused delete shows the server's message and keeps the row", async () => {
    mockFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") {
        return Promise.reject(
          new Error("Supplier has purchases and cannot be deleted")
        )
      }
      return Promise.resolve(listResponse([acme]))
    })

    renderPage()
    await screen.findByText("Acme Perfumes")

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect(
      await screen.findByText("Supplier has purchases and cannot be deleted")
    ).toBeInTheDocument()
    expect(screen.getByText("Acme Perfumes")).toBeInTheDocument()
  })

  it("pagination next/prev change the offset", async () => {
    mockFetch.mockResolvedValue(listResponse([acme], 25))

    renderPage()
    await screen.findByText("Acme Perfumes")

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(lastListCall()[1].query).toMatchObject({ offset: 20 }))

    fireEvent.click(await screen.findByRole("button", { name: "Previous" }))
    await waitFor(() => expect(lastListCall()[1].query).toMatchObject({ offset: 0 }))
  })
})
