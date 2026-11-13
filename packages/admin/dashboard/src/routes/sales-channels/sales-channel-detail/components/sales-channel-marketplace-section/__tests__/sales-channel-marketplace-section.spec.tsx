// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.message !== undefined) {
        return `${key}|${opts.message}`
      }
      if (opts?.linked !== undefined) {
        return `${key}|${opts.linked}|${opts.alreadyLinked}|${opts.unmatched}|${opts.duplicates}`
      }
      return key
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  save: vi.fn(),
  test: vi.fn(),
  link: vi.fn(),
  disconnect: vi.fn(),
  create: vi.fn(),
  pending: { test: false, link: false, disconnect: false },
  prompt: vi.fn(),
  refetch: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock("@medusajs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@medusajs/ui")>("@medusajs/ui")
  return { ...actual, toast: mocks.toast, usePrompt: () => mocks.prompt }
})

vi.mock("../../../../../../hooks/api/marketplace-connections", () => ({
  useMarketplaceConnection: () => mocks.query,
  useSaveMarketplaceConnection: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
  useTestMarketplaceConnection: () => ({
    mutateAsync: mocks.test,
    isPending: mocks.pending.test,
  }),
  useLinkMarketplaceConnection: () => ({
    mutateAsync: mocks.link,
    isPending: mocks.pending.link,
  }),
  useDisconnectMarketplaceConnection: () => ({
    mutateAsync: mocks.disconnect,
    isPending: mocks.pending.disconnect,
  }),
  useCreateMarketplaceSalesChannel: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
}))

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

import { SalesChannelMarketplaceSection } from ".."

const connection = (over: Record<string, unknown> = {}) => ({
  id: "conn_1",
  marketplace: "shopify",
  display_name: null,
  status: "connected",
  last_error: null,
  last_synced_at: "2026-11-14T10:00:00.000Z",
  linked_listings: 12,
  sales_channel_id: "sc_1",
  managed: true,
  read_only: false,
  credentials_source: "database",
  sync_live: true,
  fields: { shop_domain: "my-store.myshopify.com", location_id: "42" },
  webhook_url: "https://hub.example.com/webhooks/conn_1",
  ...over,
})

const setConnection = (conn: unknown, extra: Record<string, unknown> = {}) => {
  mocks.query = {
    connection: conn,
    isPending: false,
    isError: false,
    refetch: mocks.refetch,
    ...extra,
  }
}

const renderSection = () =>
  render(<SalesChannelMarketplaceSection salesChannelId="sc_1" />)

beforeEach(() => {
  mocks.pending.test = mocks.pending.link = mocks.pending.disconnect = false
  setConnection(connection())
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SalesChannelMarketplaceSection", () => {
  it("shows status, linked listings, last error and webhook url", () => {
    setConnection(
      connection({ status: "error", last_error: "401 unauthorized" })
    )
    renderSection()
    expect(screen.getByText("error")).toBeTruthy()
    expect(screen.getByText("12")).toBeTruthy()
    expect(screen.getByText("401 unauthorized")).toBeTruthy()
    expect(screen.getByText("my-store.myshopify.com")).toBeTruthy()
    expect(
      screen.getByText("https://hub.example.com/webhooks/conn_1")
    ).toBeTruthy()
  })

  it("secret inputs are empty and show the stored hint", () => {
    renderSection()
    fireEvent.click(
      screen.getByText("salesChannels.marketplace.editCredentials")
    )
    const token = screen.getByLabelText("Access token") as HTMLInputElement
    expect(token.type).toBe("password")
    expect(token.value).toBe("")
    expect(screen.getAllByText("salesChannels.marketplace.stored").length).toBe(
      2
    )
    expect(
      (screen.getByLabelText("Shop domain") as HTMLInputElement).value
    ).toBe("my-store.myshopify.com")
  })

  it("Edit saves only typed fields and shows a 422 message", async () => {
    mocks.save.mockRejectedValueOnce(
      Object.assign(new Error("bad token"), { status: 422 })
    )
    renderSection()
    fireEvent.click(
      screen.getByText("salesChannels.marketplace.editCredentials")
    )
    fireEvent.change(screen.getByLabelText("Access token"), {
      target: { value: "shpat_new" },
    })
    fireEvent.click(screen.getByText("actions.save"))

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(mocks.save).toHaveBeenCalledWith({ access_token: "shpat_new" })
    expect(screen.getByText("bad token")).toBeTruthy()
    expect(
      screen.getByText("salesChannels.marketplace.testFailedUnchanged")
    ).toBeTruthy()
  })

  it("hides the stored hint when the connection has no stored credentials", () => {
    setConnection(connection({ credentials_source: "none" }))
    renderSection()
    fireEvent.click(
      screen.getByText("salesChannels.marketplace.editCredentials")
    )
    expect(screen.queryByText("salesChannels.marketplace.stored")).toBeNull()
  })

  it("omits the unchanged note on a 422 when the connection is not connected", async () => {
    setConnection(connection({ status: "error" }))
    mocks.save.mockRejectedValueOnce(
      Object.assign(new Error("bad token"), { status: 422 })
    )
    renderSection()
    fireEvent.click(
      screen.getByText("salesChannels.marketplace.editCredentials")
    )
    fireEvent.change(screen.getByLabelText("Access token"), {
      target: { value: "shpat_new" },
    })
    fireEvent.click(screen.getByText("actions.save"))

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(screen.getByText("bad token")).toBeTruthy()
    expect(
      screen.queryByText("salesChannels.marketplace.testFailedUnchanged")
    ).toBeNull()
  })

  it("Test, Link and Disconnect call their hooks", async () => {
    mocks.test.mockResolvedValue({ ok: false, message: "nope" })
    mocks.link.mockResolvedValue({
      linked: 3,
      already_linked: 1,
      unmatched: 2,
      duplicates: 0,
    })
    mocks.prompt.mockResolvedValue(true)
    mocks.disconnect.mockResolvedValue({ ok: true })
    renderSection()

    fireEvent.click(screen.getByText("salesChannels.marketplace.test"))
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        "salesChannels.marketplace.toast.testFailed|nope"
      )
    )

    fireEvent.click(screen.getByText("salesChannels.marketplace.linkProducts"))
    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "salesChannels.marketplace.toast.linked|3|1|2|0"
      )
    )

    fireEvent.click(screen.getByText("salesChannels.marketplace.disconnect"))
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalled())
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "salesChannels.marketplace.toast.disconnectedOk"
    )
  })

  it("disables every action while one is running", () => {
    mocks.pending.test = true
    renderSection()
    for (const key of ["editCredentials", "linkProducts", "disconnect"]) {
      const button = screen
        .getByText(`salesChannels.marketplace.${key}`)
        .closest("button")!
      expect(button.disabled).toBe(true)
    }
  })

  it("Disconnect asks for confirmation", async () => {
    mocks.prompt.mockResolvedValue(false)
    renderSection()
    fireEvent.click(screen.getByText("salesChannels.marketplace.disconnect"))
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalled())
    expect(mocks.disconnect).not.toHaveBeenCalled()
  })

  it("Amazon disables Test and Link", () => {
    setConnection(
      connection({ marketplace: "amazon", sync_live: false, fields: {} })
    )
    renderSection()
    expect(
      screen.getByText("salesChannels.marketplace.syncNotLive")
    ).toBeTruthy()
    for (const key of ["test", "linkProducts"]) {
      const button = screen
        .getByText(`salesChannels.marketplace.${key}`)
        .closest("button")!
      expect(button.disabled).toBe(true)
    }
  })

  it("legacy connection is read-only", () => {
    setConnection(connection({ read_only: true, managed: false }))
    renderSection()
    expect(screen.getByText("connected")).toBeTruthy()
    expect(
      screen.queryByText("salesChannels.marketplace.editCredentials")
    ).toBeNull()
    expect(screen.queryByText("salesChannels.marketplace.test")).toBeNull()
    expect(
      screen.queryByText("salesChannels.marketplace.disconnect")
    ).toBeNull()
  })

  it("a channel without a connection offers Connect and attaches to this channel", async () => {
    setConnection(null)
    mocks.create.mockResolvedValue({
      sales_channel: { id: "sc_1", name: "x" },
      connection_status: "connected",
    })
    renderSection()
    fireEvent.click(screen.getByText("salesChannels.marketplace.connect"))
    fireEvent.click(screen.getByLabelText("Shopify"))
    fireEvent.change(screen.getByLabelText("Shop domain"), {
      target: { value: "a.myshopify.com" },
    })
    fireEvent.click(screen.getByText("actions.save"))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        marketplace: "shopify",
        sales_channel_id: "sc_1",
        shop_domain: "a.myshopify.com",
      })
    )
  })

  it("tolerates a failed connection query with a retry", () => {
    setConnection(null, { isError: true })
    renderSection()
    fireEvent.click(screen.getByText("salesChannels.marketplace.retry"))
    expect(mocks.refetch).toHaveBeenCalled()
  })
})
