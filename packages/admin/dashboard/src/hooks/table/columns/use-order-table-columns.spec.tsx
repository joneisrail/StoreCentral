// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock(
  "../../../components/table/table-cells/order/order-notes-indicator-cell",
  () => ({
    OrderNotesIndicatorCell: () => null,
    OrderNotesIndicatorHeader: () => null,
  })
)

import { useOrderTableColumns } from "./use-order-table-columns"

afterEach(cleanup)

const renderOrderCell = (order: Record<string, unknown>) => {
  const { result } = renderHook(() => useOrderTableColumns({}))
  const column = result.current.find(
    (c: any) => c.accessorKey === "display_id"
  ) as any
  render(
    column.cell({
      getValue: () => order.display_id,
      row: { original: order },
    })
  )
}

describe("order number cell hold badge", () => {
  it("shows an On hold badge with the reason for a tagged order", () => {
    renderOrderCell({
      display_id: 5,
      tags: [{ value: "On hold" }],
      metadata: { hold: { reason: "fraud check" } },
    })
    const badge = screen.getByText("orders.rowActions.onHoldBadge")
    expect(badge.getAttribute("title")).toBe("fraud check")
  })

  it("shows no badge for an order that is not held", () => {
    renderOrderCell({ display_id: 6, tags: [{ value: "Gift" }] })
    expect(screen.queryByText("orders.rowActions.onHoldBadge")).toBeNull()
  })
})
