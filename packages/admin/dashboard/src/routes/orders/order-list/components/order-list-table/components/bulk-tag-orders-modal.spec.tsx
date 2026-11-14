// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockUseComboboxData } = vi.hoisted(() => ({
  mockUseComboboxData: vi.fn(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("../../../../../../lib/client", () => ({ sdk: {} }))
vi.mock("../../../../../../hooks/use-combobox-data", () => ({
  useComboboxData: (args: unknown) => mockUseComboboxData(args),
}))
vi.mock("../../../../../../hooks/api/order-tags", () => ({
  orderTagsQueryKeys: { lists: () => ["order-tags"] },
  useBulkTagOrders: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock("../../../../../../components/inputs/combobox", () => ({
  Combobox: () => null,
}))

import { BulkTagOrdersModal } from "./bulk-tag-orders-modal"

afterEach(() => {
  cleanup()
  mockUseComboboxData.mockReset()
})

describe("BulkTagOrdersModal", () => {
  it.each(["add", "remove"] as const)(
    "never offers the reserved 'On hold' tag as an option in %s mode",
    (mode) => {
      mockUseComboboxData.mockReturnValue({ options: [] })

      render(
        <BulkTagOrdersModal
          action={{ mode, orderIds: ["order_1"] }}
          onClose={() => {}}
        />
      )

      const { getOptions } = mockUseComboboxData.mock.calls[0][0]
      expect(
        getOptions({
          order_tags: [
            { id: "t1", value: "gift" },
            { id: "t2", value: "On hold" },
            { id: "t3", value: "On hold later" },
          ],
        })
      ).toEqual([
        { label: "gift", value: "t1" },
        { label: "On hold later", value: "t3" },
      ])
    }
  )
})
