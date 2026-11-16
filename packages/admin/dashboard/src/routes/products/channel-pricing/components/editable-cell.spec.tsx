// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: { channel?: string }) => {
      return o?.channel ? `${key}:${o.channel}` : key
    },
  }),
}))

import { EditableCell } from "./editable-cell"
import { SyncButton } from "./sync-button"

afterEach(cleanup)

const setup = (over: Record<string, unknown> = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <EditableCell
      kind="price"
      value={10}
      display="10.00"
      label="Edit Shopify price"
      onSave={onSave}
      {...over}
    />
  )
  return { onSave }
}

const open = () => {
  fireEvent.click(screen.getByRole("button", { name: "Edit Shopify price" }))
  return screen.getByRole("textbox") as HTMLInputElement
}

describe("EditableCell", () => {
  it("exposes the pencil as a focusable button", () => {
    setup()
    expect(
      screen.getByRole("button", { name: "Edit Shopify price" })
    ).toBeTruthy()
  })

  it("Enter saves the parsed value", async () => {
    const { onSave } = setup()
    const input = open()
    fireEvent.change(input, { target: { value: "12.5" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(12.5))
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull())
  })

  it("Esc cancels without saving, even if blur follows", () => {
    const { onSave } = setup()
    const input = open()
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.keyDown(input, { key: "Escape" })
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("blur saves", async () => {
    const { onSave } = setup({ kind: "stock", value: 3, display: "3" })
    const input = open()
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.blur(input)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7))
  })

  it("does not call save when the value is unchanged", () => {
    const { onSave } = setup()
    const input = open()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("empty price clears the channel price (null)", async () => {
    const { onSave } = setup()
    const input = open()
    expect(input.placeholder).toBe("channelPricing.edit.basePrice")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
  })

  it.each([
    ["-1"],
    ["abc"],
    ["1e3"],
    ["1.234"],
    ["12."],
    ["12,5"],
    ["1000001"],
    ["9".repeat(400)],
  ])("rejects invalid price %s inline", (bad) => {
    const { onSave } = setup()
    const input = open()
    fireEvent.change(input, { target: { value: bad } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it.each([["1.5"], ["-2"], [""], ["x"], ["1000001"]])(
    "rejects invalid stock %j inline",
    (bad) => {
      const { onSave } = setup({ kind: "stock", value: 3, display: "3" })
      const input = open()
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.keyDown(input, { key: "Enter" })
      expect(onSave).not.toHaveBeenCalled()
      expect(screen.getByRole("alert")).toBeTruthy()
    }
  )

  it("shows the backend over-allocation message and stays in edit mode", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new Error("Only 2 free units are available"))
    setup({ kind: "stock", value: 3, display: "3", onSave })
    const input = open()
    fireEvent.change(input, { target: { value: "50" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(
      await screen.findByText("Only 2 free units are available")
    ).toBeTruthy()
    expect(screen.getByRole("textbox")).toBeTruthy()
  })

  it("keeps focus after a failed save, Enter retries, Esc cancels, blur does not resubmit", async () => {
    let reject!: (e: Error) => void
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, rej) => {
            reject = rej
          })
      )
      .mockRejectedValue(new Error("Only 2 free units"))
    setup({ kind: "stock", value: 3, display: "3", onSave })
    const input = open()
    input.focus()
    fireEvent.change(input, { target: { value: "50" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input.readOnly).toBe(true)
    reject(new Error("Only 2 free units"))
    await screen.findByText("Only 2 free units")
    expect(input.readOnly).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(input))
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    await screen.findByText("Only 2 free units")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("does not steal focus from another control after a failed save", async () => {
    let reject!: (e: Error) => void
    const onSave = vi.fn(
      () =>
        new Promise((_, rej) => {
          reject = rej
        })
    )
    setup({ kind: "stock", value: 3, display: "3", onSave })
    const other = document.createElement("button")
    document.body.appendChild(other)
    const input = open()
    input.focus()
    fireEvent.change(input, { target: { value: "50" } })
    fireEvent.keyDown(input, { key: "Enter" })
    other.focus()
    reject(new Error("Only 2 free units"))
    await screen.findByText("Only 2 free units")
    await new Promise((r) => setTimeout(r, 10))
    expect(document.activeElement).toBe(other)
    other.remove()
  })

  it("editing after an error clears it and Enter retries", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Only 2 free units"))
      .mockResolvedValueOnce(undefined)
    setup({ kind: "stock", value: 3, display: "3", onSave })
    const input = open()
    fireEvent.change(input, { target: { value: "50" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await screen.findByText("Only 2 free units")
    fireEvent.change(input, { target: { value: "2" } })
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(2))
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull())
  })

  it("Enter then blur makes one request", async () => {
    const { onSave } = setup()
    const input = open()
    fireEvent.change(input, { target: { value: "12" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull())
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("describes a failed cell with its error text", () => {
    setup({ failed: true, error: "Rejected by eBay" })
    const id = screen
      .getByRole("button", { name: "Edit Shopify price" })
      .getAttribute("aria-describedby") as string
    expect(document.getElementById(id)?.textContent).toBe("Rejected by eBay")
  })

  it("does not show a strikethrough equal to the current value", () => {
    setup({ pending: true, previousDisplay: "10.00" })
    expect(screen.getAllByText("10.00")).toHaveLength(1)
  })

  it("renders read-only text without a pencil", () => {
    setup({ readOnly: true })
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("10.00")).toBeTruthy()
  })

  it("shows pending amber with the previous value struck through", () => {
    setup({ pending: true, previousDisplay: "8.00" })
    const prev = screen.getByText("8.00")
    expect(prev.className).toContain("line-through")
    expect(screen.getByTestId("editable-cell").getAttribute("data-state")).toBe(
      "pending"
    )
  })

  it("shows the failed state with last_error as title", () => {
    setup({ failed: true, error: "Rejected by eBay" })
    const cell = screen.getByTestId("editable-cell")
    expect(cell.getAttribute("data-state")).toBe("failed")
    expect(cell.getAttribute("title")).toBe("Rejected by eBay")
  })
})

describe("SyncButton", () => {
  it("shows live and no button without a connection", () => {
    render(
      <SyncButton
        channelName="Webstore"
        live
        hasConnection={false}
        state={null}
        onSync={vi.fn()}
      />
    )
    expect(screen.getByText("channelPricing.live")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("shows Not connected for a marketplace without a connection", () => {
    render(
      <SyncButton
        channelName="eBay"
        hasConnection={false}
        state={null}
        onSync={vi.fn()}
      />
    )
    expect(screen.getByText("channelPricing.notConnected")).toBeTruthy()
    expect(screen.queryByText("channelPricing.live")).toBeNull()
  })

  it("names the failed retry button and links the error", () => {
    render(
      <SyncButton
        channelName="eBay"
        hasConnection
        state="failed"
        error="Rejected by eBay"
        onSync={vi.fn()}
      />
    )
    const btn = screen.getByRole("button", {
      name: "channelPricing.sync.retry:eBay",
    })
    const id = btn.getAttribute("aria-describedby") as string
    expect(document.getElementById(id)?.textContent).toBe("Rejected by eBay")
  })

  it("shows busy while syncing, then idle", async () => {
    let resolve!: () => void
    const onSync = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        })
    )
    render(
      <SyncButton
        channelName="eBay"
        hasConnection
        state="pending"
        onSync={onSync}
      />
    )
    const btn = screen.getByRole("button", {
      name: "channelPricing.sync.label:eBay",
    })
    fireEvent.click(btn)
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(btn.getAttribute("aria-busy")).toBe("true")
    resolve()
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBe("false"))
  })

  it("shows the sync failure message", async () => {
    render(
      <SyncButton
        channelName="eBay"
        hasConnection
        state="failed"
        onSync={vi.fn().mockRejectedValue(new Error("No connection"))}
      />
    )
    fireEvent.click(screen.getByRole("button"))
    expect(await screen.findByText("No connection")).toBeTruthy()
  })
})
