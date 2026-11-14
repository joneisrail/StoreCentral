// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))

import { DataTableFilter, Filter } from "./data-table-filter"

const filters: Filter[] = [{ key: "sku", label: "SKU", type: "string" }]

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => cleanup())

const renderFilter = (props: { hideClearAll?: boolean }) =>
  render(
    <MemoryRouter initialEntries={["/?p_sku=ABC"]}>
      <DataTableFilter filters={filters} prefix="p" {...props} />
    </MemoryRouter>
  )

describe("DataTableFilter Clear all", () => {
  it("shows the built-in Clear all by default", () => {
    renderFilter({})
    expect(screen.getByText("Clear all")).toBeTruthy()
  })

  it("hides it with hideClearAll", () => {
    renderFilter({ hideClearAll: true })
    expect(screen.getByText("SKU")).toBeTruthy()
    expect(screen.queryByText("Clear all")).toBeNull()
  })
})
