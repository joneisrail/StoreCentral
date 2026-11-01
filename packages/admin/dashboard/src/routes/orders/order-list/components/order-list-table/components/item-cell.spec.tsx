// @vitest-environment jsdom
import { TooltipProvider } from "@medusajs/ui"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ItemCell } from "./item-cell"

afterEach(() => {
  cleanup()
})

describe("ItemCell", () => {
  it("renders thumbnail, title, and remaining quantity for every line item, stacked", () => {
    render(
      <TooltipProvider>
        <ItemCell
          items={
            [
              {
                id: "li_1",
                title: "Red Shirt",
                thumbnail: "shirt.png",
                quantity: 3,
                detail: { fulfilled_quantity: 1 },
              },
              {
                id: "li_2",
                title: "Blue Hat",
                thumbnail: "hat.png",
                quantity: 1,
                detail: { fulfilled_quantity: 0 },
              },
            ] as any
          }
        />
      </TooltipProvider>
    )

    expect(screen.getByText("Red Shirt")).toBeTruthy()
    expect(screen.getByText("2x")).toBeTruthy() // 3 - 1 remaining
    expect(screen.getByText("Blue Hat")).toBeTruthy()
    expect(screen.getByText("1x")).toBeTruthy()
  })

  it("renders a placeholder icon instead of an img when the item has no thumbnail", () => {
    render(
      <TooltipProvider>
        <ItemCell
          items={
            [
              {
                id: "li_1",
                title: "No Image Item",
                thumbnail: null,
                quantity: 1,
                detail: { fulfilled_quantity: 0 },
              },
            ] as any
          }
        />
      </TooltipProvider>
    )

    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("No Image Item")).toBeTruthy()
  })
})
