// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Keys render as "key" or "key|<value>|<value>..." (option values in order)
// so the assertions can see the interpolated values without translations.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) {
        return key
      }
      return [key, ...Object.values(opts)].join("|")
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  statusArgs: [] as unknown[][],
  refetch: vi.fn(),
}))

vi.mock("../../../../../../hooks/api/marketplace-connections", () => ({
  useSyncStatus: (...args: unknown[]) => {
    mocks.statusArgs.push(args)
    return mocks.status
  },
}))

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

import { ChannelSyncStatusPanel } from ".."

const statusData = (over: Record<string, unknown> = {}) => ({
  sync_live: true,
  connection: {
    status: "connected",
    last_error: null,
    last_synced_at: "2026-11-23T10:00:00.000Z",
  },
  listings: {
    total: 17,
    by_status: { published: 11, error: 6 },
    with_error: 4,
    never_pushed: 3,
  },
  jobs: {
    by_type: {
      product: { pending: 2, processing: 1, failed: 5, succeeded: 40 },
      inventory: { pending: 0, processing: 0, failed: 0, succeeded: 9 },
    },
    last_succeeded_at: {
      product: "2026-11-23T09:00:00.000Z",
      inventory: "2026-11-23T08:00:00.000Z",
      price: null,
      order: null,
      tracking: null,
    },
  },
  recent_failures: [
    {
      sync_type: "product",
      external_id: "SKU-RED",
      attempts: 3,
      last_error: "price rejected",
      updated_at: "2026-11-23T09:30:00.000Z",
    },
  ],
  failures_total: 1,
  ...over,
})

const setStatus = (extra: Record<string, unknown> = {}) => {
  mocks.status = {
    data: statusData(),
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
    ...extra,
  }
}

const renderPanel = (marketplace = "shopify") =>
  render(
    <ChannelSyncStatusPanel connectionId="conn_1" marketplace={marketplace} />
  )

const K = "salesChannels.marketplace.syncStatus"

const button = (key: string) =>
  screen.getByText(`${K}.${key}`).closest("button")!

beforeEach(() => {
  mocks.statusArgs = []
  setStatus()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ChannelSyncStatusPanel", () => {
  it("shows counts jobs and failures", () => {
    renderPanel()
    expect(mocks.statusArgs[0][0]).toBe("conn_1")

    expect(screen.getByText(`${K}.listingsTotal|17`)).toBeTruthy()
    expect(screen.getByText(`${K}.listingsByStatus|published|11`)).toBeTruthy()
    expect(screen.getByText(`${K}.listingsByStatus|error|6`)).toBeTruthy()
    expect(screen.getByText(`${K}.withError|4`)).toBeTruthy()
    expect(screen.getByText(`${K}.neverPushed|3`)).toBeTruthy()

    // Five job kinds in a fixed order, missing kinds count as zero.
    const kinds = ["product", "inventory", "price", "order", "tracking"]
    const kindCells = screen
      .getAllByText(new RegExp(`^${K.replace(/\./g, "\\.")}\\.kinds\\.`))
      .map((el) => el.textContent)
    expect(kindCells.slice(0, 5)).toEqual(kinds.map((k) => `${K}.kinds.${k}`))

    const productRow = screen
      .getAllByText(`${K}.kinds.product`)[0]
      .closest("tr")!
    const cells = Array.from(productRow.querySelectorAll("td")).map(
      (td) => td.textContent
    )
    expect(cells.slice(0, 4)).toEqual([`${K}.kinds.product`, "2", "1", "5"])
    expect(cells[4]).toBe(new Date("2026-11-23T09:00:00.000Z").toLocaleString())

    const priceRow = screen.getAllByText(`${K}.kinds.price`)[0].closest("tr")!
    const priceCells = Array.from(priceRow.querySelectorAll("td")).map(
      (td) => td.textContent
    )
    expect(priceCells).toEqual([
      `${K}.kinds.price`,
      "0",
      "0",
      "0",
      `${K}.never`,
    ])

    const failureRow = screen.getByText("SKU-RED").closest("tr")!
    expect(failureRow.textContent).toContain("price rejected")
    expect(failureRow.textContent).toContain("3")
    expect(failureRow.textContent).toContain(
      new Date("2026-11-23T09:30:00.000Z").toLocaleString()
    )
    expect(screen.queryByText(new RegExp(`${K}.failuresShown`))).toBeNull()
    expect(screen.queryByText(`${K}.notRunning`)).toBeNull()
  })

  it("error banner with retry and no numbers", () => {
    // React Query keeps the last data on a failed refetch; it must not show.
    setStatus({
      isError: true,
      error: Object.assign(new Error("seller-hub unreachable"), {
        status: 502,
      }),
    })
    renderPanel()
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("seller-hub unreachable")
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByText(`${K}.listingsTotal|17`)).toBeNull()
    expect(screen.queryByText("SKU-RED")).toBeNull()
    fireEvent.click(button("retry"))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it("not running notice with stored counts", () => {
    setStatus({ data: statusData({ sync_live: false }) })
    renderPanel()
    expect(screen.getByText(`${K}.notRunning`)).toBeTruthy()
    expect(screen.getByText(`${K}.listingsTotal|17`)).toBeTruthy()
    expect(screen.getByText("SKU-RED")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows Showing N of M", () => {
    setStatus({ data: statusData({ failures_total: 40 }) })
    renderPanel()
    expect(screen.getByText(`${K}.failuresShown|1|40`)).toBeTruthy()
  })

  it("refresh refetches", () => {
    renderPanel()
    fireEvent.click(button("refresh"))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it("shows a loading line before the first result", () => {
    setStatus({ data: undefined, isPending: true })
    renderPanel()
    expect(screen.getByText(`${K}.loading`)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("hidden for amazon", () => {
    const { container } = renderPanel("amazon")
    expect(container.innerHTML).toBe("")
    expect(mocks.statusArgs.length).toBe(0)
  })

  it("shown for woocommerce", () => {
    renderPanel("woocommerce")
    expect(screen.getByText(`${K}.title`)).toBeTruthy()
  })
})
