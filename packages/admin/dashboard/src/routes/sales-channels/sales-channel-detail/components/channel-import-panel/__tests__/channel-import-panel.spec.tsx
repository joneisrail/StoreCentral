// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Keys render as "key" or "key|<count>|<message>" so the assertions can see
// the interpolated values without the real translations.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) {
        return key
      }
      return [key, opts.count, opts.message, opts.sku]
        .filter((v) => v !== undefined)
        .join("|")
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  preview: {} as Record<string, unknown>,
  previewArgs: [] as unknown[][],
  run: vi.fn(),
  runPending: false,
  refetch: vi.fn(),
}))

vi.mock("../../../../../../hooks/api/marketplace-connections", () => ({
  useImportPreview: (...args: unknown[]) => {
    mocks.previewArgs.push(args)
    const enabled = (args[1] as { enabled?: boolean } | undefined)?.enabled
    return enabled
      ? mocks.preview
      : { data: undefined, isPending: true, isFetching: false, isError: false }
  },
  useRunImport: () => ({
    mutateAsync: mocks.run,
    isPending: mocks.runPending,
  }),
}))

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

import { ChannelImportPanel } from ".."

const previewData = (over: Record<string, unknown> = {}) => ({
  matched: [{ sku: "M1", title: "Matched one" }],
  unmatched: [
    {
      sku: "U1",
      title: "Blue shirt",
      price: "10.00",
      stock: 3,
      image_url: null,
    },
    {
      sku: "U2",
      title: "Red shirt",
      price: "12.00",
      stock: 0,
      image_url: null,
    },
  ],
  duplicates: ["D1"],
  no_sku: [],
  matched_total: 4,
  unmatched_total: 2,
  duplicates_total: 1,
  no_sku_total: 3,
  ...over,
})

const outcome = (over: Record<string, unknown> = {}) => ({
  imported: ["U1"],
  failed: [],
  failed_total: 0,
  skipped_counts: { already_linked: 0, matched: 0, currency: 0 },
  skipped: [],
  skipped_total: 0,
  deferred: [],
  deferred_total: 0,
  ...over,
})

const setPreview = (extra: Record<string, unknown> = {}) => {
  mocks.preview = {
    data: previewData(),
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
    ...extra,
  }
}

const renderPanel = (marketplace = "shopify") =>
  render(<ChannelImportPanel connectionId="conn_1" marketplace={marketplace} />)

const button = (key: string) =>
  screen
    .getByText(new RegExp(`^salesChannels\\.marketplace\\.import\\.${key}`))
    .closest("button")!

const checkProducts = () => fireEvent.click(button("check"))

beforeEach(() => {
  mocks.runPending = false
  mocks.previewArgs = []
  setPreview()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ChannelImportPanel", () => {
  it("does not load the preview until Check products is pressed", () => {
    renderPanel()
    expect(mocks.previewArgs.every((a) => a[0] === "conn_1")).toBe(true)
    expect(
      mocks.previewArgs.some(
        (a) => (a[1] as { enabled?: boolean })?.enabled === true
      )
    ).toBe(false)
    expect(screen.queryByText("Blue shirt")).toBeNull()
  })

  it("shows four counts after preview", () => {
    renderPanel()
    checkProducts()
    expect(
      screen.getByText("salesChannels.marketplace.import.matched|4")
    ).toBeTruthy()
    expect(
      screen.getByText("salesChannels.marketplace.import.toImport|2")
    ).toBeTruthy()
    expect(
      screen.getByText("salesChannels.marketplace.import.duplicates|1")
    ).toBeTruthy()
    expect(
      screen.getByText("salesChannels.marketplace.import.noSku|3")
    ).toBeTruthy()
    expect(screen.getByText("Blue shirt")).toBeTruthy()
    expect(screen.getByText("Red shirt")).toBeTruthy()
  })

  it("import selected sends chosen skus", async () => {
    mocks.run.mockResolvedValue(outcome())
    renderPanel()
    checkProducts()
    expect(button("importSelected").disabled).toBe(true)

    fireEvent.click(screen.getByRole("checkbox", { name: "U2" }))
    expect(button("importSelected").disabled).toBe(false)
    fireEvent.click(button("importSelected"))

    await waitFor(() =>
      expect(mocks.run).toHaveBeenCalledWith({ skus: ["U2"] })
    )
    expect(
      await screen.findByText("salesChannels.marketplace.import.imported|1")
    ).toBeTruthy()
  })

  it("import all sends skus: all", async () => {
    mocks.run.mockResolvedValue(
      outcome({
        imported: ["U1"],
        failed: [{ sku: "U2", message: "price missing" }],
        failed_total: 1,
        skipped_counts: { already_linked: 2, matched: 1, currency: 0 },
        skipped_total: 3,
      })
    )
    renderPanel()
    checkProducts()
    fireEvent.click(button("importAll"))

    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith({ skus: "all" }))
    expect(
      await screen.findByText("salesChannels.marketplace.import.failed|1")
    ).toBeTruthy()
    expect(screen.getByText("U2: price missing")).toBeTruthy()
    expect(
      screen.getByText(
        "salesChannels.marketplace.import.skippedAlreadyLinked|2"
      )
    ).toBeTruthy()
    expect(
      screen.getByText("salesChannels.marketplace.import.skippedMatched|1")
    ).toBeTruthy()
  })

  it("disables the import buttons while an import runs", () => {
    const { rerender } = renderPanel()
    checkProducts()
    fireEvent.click(screen.getByRole("checkbox", { name: "U1" }))
    expect(button("importSelected").disabled).toBe(false)
    mocks.runPending = true
    rerender(<ChannelImportPanel connectionId="conn_1" marketplace="shopify" />)
    expect(button("importSelected").disabled).toBe(true)
    expect(button("importAll").disabled).toBe(true)
  })

  it("shows error and retry when preview fails", () => {
    setPreview({
      data: undefined,
      isError: true,
      error: Object.assign(new Error("seller-hub unreachable"), {
        status: 502,
      }),
    })
    renderPanel()
    checkProducts()
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("seller-hub unreachable")
    expect(screen.queryByRole("table")).toBeNull()
    fireEvent.click(button("retry"))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it("shows the message when the import call fails", async () => {
    mocks.run.mockRejectedValue(new Error("import timed out"))
    renderPanel()
    checkProducts()
    fireEvent.click(button("importAll"))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "import timed out"
      )
    )
  })

  it("hidden for amazon", () => {
    const { container } = renderPanel("amazon")
    expect(container.innerHTML).toBe("")
    expect(mocks.previewArgs.length).toBe(0)
  })

  it("shown for woocommerce", () => {
    renderPanel("woocommerce")
    expect(button("check")).toBeTruthy()
  })

  it("shows deferred count after a capped run", async () => {
    mocks.run.mockResolvedValue(
      outcome({
        imported: Array.from({ length: 200 }, (_, i) => `S${i}`),
        deferred: ["S200", "S201"],
        deferred_total: 57,
      })
    )
    renderPanel()
    checkProducts()
    fireEvent.click(button("importAll"))
    expect(
      await screen.findByText("salesChannels.marketplace.import.imported|200")
    ).toBeTruthy()
    expect(
      screen.getByText("salesChannels.marketplace.import.deferred|57")
    ).toBeTruthy()
  })
})
