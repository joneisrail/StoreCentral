// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useSearchParams } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))
vi.mock("../../../../../../lib/client", () => ({ sdk: {} }))
vi.mock("../../../../../../hooks/api/regions", () => ({
  useRegions: () => ({ regions: [{ id: "reg_1", name: "North America" }] }),
}))
vi.mock("../../../../../../hooks/api/sales-channels", () => ({
  useSalesChannels: () => ({ sales_channels: [{ id: "sc_1", name: "Web" }] }),
}))
vi.mock("../../../../../../hooks/api/order-tags", () => ({
  useOrderTags: () => ({ order_tags: [{ id: "tag_1", value: "VIP" }] }),
}))
vi.mock("../../../../../../hooks/api/stock-locations", () => ({
  useStockLocations: () => ({
    stock_locations: [{ id: "loc_1", name: "Warehouse" }],
  }),
}))

import { useTabTableQuery } from "../use-tab-table-query"
import { TabTableToolbar } from "./tab-table-toolbar"

beforeAll(() => {
  // Radix / cmdk measure and scroll elements jsdom does not implement.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => cleanup())

const Harness = ({
  searchState = { truncated: false, isError: false, refetch: vi.fn() },
}: {
  searchState?: { truncated: boolean; isError: boolean; refetch: () => void }
}) => {
  const query = useTabTableQuery("rts")
  const [sp] = useSearchParams()
  return (
    <>
      <TabTableToolbar prefix="rts" query={query} searchState={searchState} />
      <output data-testid="url">{sp.toString()}</output>
    </>
  )
}

const renderToolbar = (initial = "/", props = {}) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Harness {...props} />
    </MemoryRouter>
  )

const url = () => decodeURIComponent(screen.getByTestId("url").textContent!)

describe("TabTableToolbar", () => {
  it("renders the search input and the Add filter button", () => {
    renderToolbar()
    expect(
      screen.getByPlaceholderText("orders.list.searchPlaceholder")
    ).toBeTruthy()
    expect(screen.getByText("filters.addFilter")).toBeTruthy()
    expect(screen.queryByText("orders.list.clearAll")).toBeNull()
  })

  it("renders chips for the filters in the URL and removes one", async () => {
    const user = userEvent.setup()
    renderToolbar("/?rts_f_region_id=reg_1&rts_f_sku=ABC")
    expect(screen.getByText("fields.region")).toBeTruthy()
    expect(screen.getByText("North America")).toBeTruthy()
    expect(screen.getByText("orders.list.filters.sku")).toBeTruthy()

    const regionChip =
      screen.getByText("fields.region").parentElement!.parentElement!
    await user.click(regionChip.querySelector("button")!)
    await waitFor(() => expect(url()).not.toContain("rts_f_region_id"))
    expect(url()).toContain("rts_f_sku=ABC")
  })

  it("adds a chip and edits its value", async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByText("filters.addFilter"))
    await user.click(await screen.findByText("fields.salesChannel"))
    await user.click(await screen.findByText("Web"))
    await waitFor(() => expect(url()).toContain("rts_f_sales_channel_id=sc_1"))
    expect(screen.getAllByText("Web").length).toBeGreaterThan(0)

    // Edit: toggle the selected option off again.
    await user.click((await screen.findAllByText("Web")).at(-1)!)
    await waitFor(() => expect(url()).not.toContain("rts_f_sales_channel_id"))
  })

  it("Clear all drops the search, the filters and their chips", async () => {
    const user = userEvent.setup()
    renderToolbar("/?rts_q=smith&rts_f_sku=ABC&shp_q=keep")
    await user.click(screen.getByText("orders.list.clearAll"))
    await waitFor(() => expect(url()).toBe("shp_q=keep"))
    expect(screen.queryByText("orders.list.filters.sku")).toBeNull()
    expect(
      (
        screen.getByPlaceholderText(
          "orders.list.searchPlaceholder"
        ) as HTMLInputElement
      ).value
    ).toBe("")
  })

  it("shows the truncation notice", () => {
    renderToolbar("/", {
      searchState: { truncated: true, isError: false, refetch: vi.fn() },
    })
    expect(screen.getByText("orders.list.searchTruncated")).toBeTruthy()
  })

  it("shows the error with a Retry that refetches", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    renderToolbar("/", {
      searchState: { truncated: false, isError: true, refetch },
    })
    expect(screen.getByText("orders.list.searchError")).toBeTruthy()
    await user.click(screen.getByText("orders.list.searchRetry"))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
