// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockUseComboboxData } = vi.hoisted(() => ({
  mockUseComboboxData: vi.fn(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock("../../../../../lib/client", () => ({ sdk: {} }))
vi.mock("../../../../../hooks/use-combobox-data", () => ({
  useComboboxData: (args: unknown) => mockUseComboboxData(args),
}))
vi.mock("../../../../../hooks/api/orders", () => ({
  ordersQueryKeys: { detail: (id: string) => ["orders", id] },
}))
vi.mock("../../../../../hooks/api/order-tags", () => ({
  orderTagsQueryKeys: { lists: () => ["order-tags"] },
  useBulkTagOrders: () => ({ mutateAsync: vi.fn() }),
  useCreateOrderTag: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("../../../../../components/inputs/combobox", () => ({
  Combobox: () => null,
}))

import { OrderTagsRow } from "./order-tags-row"

afterEach(() => {
  cleanup()
  mockUseComboboxData.mockReset()
})

describe("OrderTagsRow reserved On hold tag", () => {
  it("has no remove button on the On hold chip and hides it from the picker", () => {
    mockUseComboboxData.mockReturnValue({ options: [] })

    render(
      <OrderTagsRow
        order={
          {
            id: "order_1",
            tags: [
              { id: "t1", value: "On hold" },
              { id: "t2", value: "gift" },
            ],
          } as any
        }
      />
    )

    expect(
      screen.getByText("On hold").parentElement?.querySelector("button")
    ).toBeNull()
    expect(
      screen.getByText("gift").parentElement?.querySelector("button")
    ).not.toBeNull()

    const { getOptions } = mockUseComboboxData.mock.calls[0][0]
    expect(
      getOptions({
        order_tags: [
          { id: "t1", value: "On hold" },
          { id: "t2", value: "gift" },
        ],
      })
    ).toEqual([{ label: "gift", value: "t2" }])
  })
})
