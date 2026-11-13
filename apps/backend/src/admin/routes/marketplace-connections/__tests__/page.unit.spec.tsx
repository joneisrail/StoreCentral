/**
 * @jest-environment jsdom
 */
import "../../purchases/__tests__/text-encoder-polyfill"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const mockFetch = jest.fn()
const mockSalesChannelList = jest.fn()

jest.mock("../../../lib/sdk", () => ({
  sdk: {
    client: { fetch: (...args: unknown[]) => mockFetch(...args) },
    admin: {
      salesChannel: {
        list: (...args: unknown[]) => mockSalesChannelList(...args),
      },
    },
  },
}))

import MarketplaceConnectionsPage, { config } from "../page"

const SECRET_VALUES = ["shpat_SECRET_TOKEN", "whsec_SECRET", "ck_SECRET_KEY"]

type Conn = Record<string, unknown>

function conn(marketplace: string, overrides: Conn = {}): Conn {
  return {
    marketplace,
    status: "disconnected",
    last_error: null,
    last_synced_at: null,
    linked_listings: 0,
    sales_channel_id: null,
    credentials_source: "none",
    read_only: false,
    fields: {},
    webhook_url: `https://hub.example.com/webhooks/${marketplace}`,
    ...overrides,
  }
}

let list: Conn[]

function baseList(): Conn[] {
  return [
    conn("shopify", {
      status: "connected",
      credentials_source: "database",
      sales_channel_id: "sc_2",
      linked_listings: 7,
      last_synced_at: "2026-11-12T10:00:00.000Z",
      fields: { shop_domain: "demo.myshopify.com", location_id: "123" },
    }),
    conn("woocommerce", {
      credentials_source: "database",
      fields: { site_url: "https://wp.example.com", consumer_key_set: true },
    }),
    conn("amazon", {
      status: "connected",
      read_only: true,
      credentials_source: "environment",
    }),
  ]
}

const fetchError = (status: number, message: string) =>
  Object.assign(new Error(message), { status })

function calls(method: string, path: string) {
  return mockFetch.mock.calls.filter(
    (c) => c[0] === path && (c[1]?.method ?? "GET") === method
  )
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketplaceConnectionsPage />
    </QueryClientProvider>
  )
}

const cardOf = (name: string) => screen.getByTestId(`connection-${name}`)

beforeEach(() => {
  jest.clearAllMocks()
  list = baseList()
  mockSalesChannelList.mockResolvedValue({
    sales_channels: [
      { id: "sc_1", name: "Default" },
      { id: "sc_2", name: "Shopify channel" },
    ],
  })
  mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
    if (url === "/admin/marketplace-connections" && !opts?.method) {
      return Promise.resolve({ connections: JSON.parse(JSON.stringify(list)) })
    }
    return Promise.reject(new Error(`unexpected fetch ${opts?.method} ${url}`))
  })
})

describe("MarketplaceConnectionsPage", () => {
  it("labels the route", () => {
    expect(config.label).toBe("Marketplace connections")
  })

  it("renders Shopify, WordPress and Amazon cards in order", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    const ids = screen
      .getAllByTestId(/^connection-/)
      .map((el) => el.getAttribute("data-testid"))
    expect(ids).toEqual([
      "connection-shopify",
      "connection-woocommerce",
      "connection-amazon",
    ])
    expect(
      within(cardOf("shopify")).getByRole("heading", { name: "Shopify" })
    ).toBeInTheDocument()
    expect(
      within(cardOf("woocommerce")).getByRole("heading", { name: "WordPress" })
    ).toBeInTheDocument()
    expect(
      within(cardOf("amazon")).getByRole("heading", { name: "Amazon" })
    ).toBeInTheDocument()
  })

  it("shows status, sync, listings, error and webhook url", async () => {
    list[0].last_error = "token expired"
    renderPage()
    const shopify = within(await screen.findByTestId("connection-shopify"))
    expect(shopify.getByText("connected")).toBeInTheDocument()
    expect(shopify.getByText(/Linked listings: 7/)).toBeInTheDocument()
    expect(shopify.getByText(/Last sync:/)).not.toHaveTextContent("never")
    expect(shopify.getByText(/token expired/)).toBeInTheDocument()
    expect(
      shopify.getByText("https://hub.example.com/webhooks/shopify")
    ).toBeInTheDocument()
  })

  it("secret inputs are empty password fields, non-secrets are prefilled", async () => {
    // A hostile response that includes secrets must never reach the DOM.
    list[0].fields = {
      shop_domain: "demo.myshopify.com",
      location_id: "123",
      access_token: SECRET_VALUES[0],
      webhook_secret: SECRET_VALUES[1],
    }
    list[1].fields = {
      site_url: "https://wp.example.com",
      consumer_key: SECRET_VALUES[2],
      consumer_key_set: true,
    }
    const { container } = renderPage()
    await screen.findByTestId("connection-shopify")

    const shopify = within(cardOf("shopify"))
    expect(shopify.getByLabelText("Store domain")).toHaveValue(
      "demo.myshopify.com"
    )
    expect(shopify.getByLabelText("Location ID")).toHaveValue("123")
    for (const label of ["Access token", "Webhook secret"]) {
      const input = shopify.getByLabelText(label)
      expect(input).toHaveAttribute("type", "password")
      expect(input).toHaveValue("")
    }
    const woo = within(cardOf("woocommerce"))
    expect(woo.getByLabelText("Site URL")).toHaveValue("https://wp.example.com")
    for (const label of ["Consumer key", "Consumer secret", "Webhook secret"]) {
      const input = woo.getByLabelText(label)
      expect(input).toHaveAttribute("type", "password")
      expect(input).toHaveValue("")
    }
    expect(shopify.getAllByText("Stored").length).toBeGreaterThan(0)

    for (const secret of SECRET_VALUES) {
      expect(container.innerHTML).not.toContain(secret)
    }
  })

  it("sales channel select takes its value from sales_channel_id", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    await waitFor(() =>
      expect(
        within(cardOf("shopify")).getByLabelText("Sales channel")
      ).toHaveValue("sc_2")
    )
    expect(within(cardOf("shopify")).getAllByText("Default").length).toBe(1)
  })

  it("save sends only non-blank fields plus sales_channel_id", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    const shopify = within(cardOf("shopify"))
    await waitFor(() =>
      expect(shopify.getByLabelText("Sales channel")).toHaveValue("sc_2")
    )
    fireEvent.change(shopify.getByLabelText("Access token"), {
      target: { value: "new-token" },
    })
    fireEvent.change(shopify.getByLabelText("Sales channel"), {
      target: { value: "sc_1" },
    })

    mockFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true, connection: list[0] })
      }
      return Promise.resolve({ connections: JSON.parse(JSON.stringify(list)) })
    })
    fireEvent.click(shopify.getByRole("button", { name: "Save and connect" }))

    await waitFor(() =>
      expect(
        calls("POST", "/admin/marketplace-connections/shopify")
      ).toHaveLength(1)
    )
    const body = calls("POST", "/admin/marketplace-connections/shopify")[0][1]
      .body
    expect(body).toEqual({
      shop_domain: "demo.myshopify.com",
      location_id: "123",
      access_token: "new-token",
      sales_channel_id: "sc_1",
    })
    expect(
      await shopify.findByText("https://hub.example.com/webhooks/shopify")
    ).toBeInTheDocument()
  })

  it("disables Save while saving", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    const shopify = within(cardOf("shopify"))
    let resolve: (v: unknown) => void = () => {}
    mockFetch.mockImplementation((_u: string, opts?: { method?: string }) =>
      opts?.method === "POST"
        ? new Promise((r) => {
            resolve = r
          })
        : Promise.resolve({ connections: list })
    )
    fireEvent.click(shopify.getByRole("button", { name: "Save and connect" }))
    await waitFor(() =>
      expect(
        shopify.getByRole("button", { name: /Save and connect/ })
      ).toBeDisabled()
    )
    await act(async () => resolve({ ok: true, connection: list[0] }))
  })

  it("a 422 shows its message on that card only", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    mockFetch.mockImplementation((_u: string, opts?: { method?: string }) =>
      opts?.method === "POST"
        ? Promise.reject(fetchError(422, "location not found"))
        : Promise.resolve({ connections: list })
    )
    fireEvent.click(
      within(cardOf("shopify")).getByRole("button", {
        name: "Save and connect",
      })
    )
    expect(
      await within(cardOf("shopify")).findByText("location not found")
    ).toBeInTheDocument()
    expect(
      within(cardOf("woocommerce")).queryByText("location not found")
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId("unavailable-banner")).not.toBeInTheDocument()
  })

  it("Test and Link call their routes and show results", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    const shopify = within(cardOf("shopify"))
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith("/test"))
        return Promise.resolve({ ok: true, detail: "Connected to Demo" })
      if (url.endsWith("/link"))
        return Promise.resolve({
          linked: 5,
          already_linked: 2,
          unmatched: 3,
          duplicates: 1,
        })
      return Promise.resolve({ connections: list })
    })
    fireEvent.click(shopify.getByRole("button", { name: "Test" }))
    expect(await shopify.findByText("Connected to Demo")).toBeInTheDocument()
    expect(
      calls("POST", "/admin/marketplace-connections/shopify/test")
    ).toHaveLength(1)

    fireEvent.click(
      shopify.getByRole("button", { name: "Link products by SKU" })
    )
    expect(
      await shopify.findByText(
        /5 linked, 2 already linked, 3 unmatched, 1 duplicates/
      )
    ).toBeInTheDocument()
    expect(
      calls("POST", "/admin/marketplace-connections/shopify/link")
    ).toHaveLength(1)
  })

  it("shows a failed test result and a 409 link error", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    const shopify = within(cardOf("shopify"))
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith("/test"))
        return Promise.resolve({ ok: false, message: "bad token" })
      if (url.endsWith("/link"))
        return Promise.reject(fetchError(409, "Conflict"))
      return Promise.resolve({ connections: list })
    })
    fireEvent.click(shopify.getByRole("button", { name: "Test" }))
    expect(await shopify.findByText("bad token")).toBeInTheDocument()
    fireEvent.click(
      shopify.getByRole("button", { name: "Link products by SKU" })
    )
    expect(await shopify.findByText(/not running/i)).toBeInTheDocument()
  })

  it("Disconnect asks for confirmation, then shows the env fallback warning", async () => {
    renderPage()
    await screen.findByTestId("connection-shopify")
    const shopify = within(cardOf("shopify"))
    mockFetch.mockImplementation((_u: string, opts?: { method?: string }) =>
      opts?.method === "DELETE"
        ? Promise.resolve({ ok: true, env_fallback: true })
        : Promise.resolve({ connections: list })
    )
    fireEvent.click(shopify.getByRole("button", { name: "Disconnect" }))
    expect(
      calls("DELETE", "/admin/marketplace-connections/shopify")
    ).toHaveLength(0)
    fireEvent.click(shopify.getByRole("button", { name: "Cancel" }))
    expect(
      calls("DELETE", "/admin/marketplace-connections/shopify")
    ).toHaveLength(0)

    fireEvent.click(shopify.getByRole("button", { name: "Disconnect" }))
    fireEvent.click(shopify.getByRole("button", { name: "Confirm disconnect" }))
    expect(
      await shopify.findByText(/environment variables will reconnect/i)
    ).toBeInTheDocument()
    expect(
      calls("DELETE", "/admin/marketplace-connections/shopify")
    ).toHaveLength(1)
  })

  it("Amazon card is status only", async () => {
    renderPage()
    await screen.findByTestId("connection-amazon")
    const amazon = within(cardOf("amazon"))
    expect(amazon.getByText("connected")).toBeInTheDocument()
    expect(amazon.queryAllByRole("textbox")).toHaveLength(0)
    expect(amazon.queryAllByRole("button")).toHaveLength(0)
    expect(amazon.queryAllByRole("combobox")).toHaveLength(0)
  })

  it("a failing list shows an error with a working Retry", async () => {
    mockFetch.mockRejectedValue(fetchError(500, "boom"))
    renderPage()
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.queryByTestId("connection-shopify")).not.toBeInTheDocument()

    mockFetch.mockResolvedValue({ connections: list })
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByTestId("connection-shopify")).toBeInTheDocument()
  })

  it("an unreachable seller-hub shows a banner while the page stays usable", async () => {
    mockFetch.mockRejectedValue(fetchError(502, "seller-hub is unreachable"))
    renderPage()
    const banner = await screen.findByTestId("unavailable-banner")
    expect(banner).toHaveTextContent("seller-hub is unreachable")
    const shopify = within(await screen.findByTestId("connection-shopify"))
    expect(shopify.getByLabelText("Store domain")).not.toBeDisabled()
    expect(
      shopify.getByRole("button", { name: "Save and connect" })
    ).toBeEnabled()
  })
})
