// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("./bulk-tag-orders-modal", () => ({
  BulkTagOrdersModal: (props: {
    action: { mode: string; orderIds: string[] }
    onClose: () => void
  }) => (
    <div data-testid="tag-modal">
      {props.action.mode}:{props.action.orderIds.join(",")}
      <button onClick={props.onClose}>close</button>
    </div>
  ),
}))

import { RowTagsCell } from "./row-tags-cell"

afterEach(cleanup)

describe("RowTagsCell", () => {
  it("shows a chip per tag and opens the modal scoped to that order", async () => {
    const user = userEvent.setup()

    render(
      <RowTagsCell
        orderId="order_9"
        tags={[
          { id: "t1", value: "gift" },
          { id: "t2", value: "rush" },
        ]}
      />
    )

    expect(screen.getByText("gift")).toBeTruthy()
    expect(screen.getByText("rush")).toBeTruthy()
    expect(screen.queryByTestId("tag-modal")).toBeNull()

    await user.click(
      screen.getByRole("button", { name: "orders.tags.addToOrder" })
    )

    expect(screen.getByTestId("tag-modal").textContent).toContain("add:order_9")

    await user.click(screen.getByText("close"))
    expect(screen.queryByTestId("tag-modal")).toBeNull()
  })

  it("still renders the plus button with no tags", () => {
    render(<RowTagsCell orderId="o" tags={null} />)
    expect(
      screen.getByRole("button", { name: "orders.tags.addToOrder" })
    ).toBeTruthy()
  })
})
