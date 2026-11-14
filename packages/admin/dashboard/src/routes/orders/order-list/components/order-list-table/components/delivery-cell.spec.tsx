// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DeliveryCell } from "./delivery-cell"

afterEach(cleanup)

describe("DeliveryCell", () => {
  it("shows the shipping method name", () => {
    render(<DeliveryCell name="Standard Shipping" />)
    expect(screen.getByText("Standard Shipping")).toBeTruthy()
  })

  it("shows a dash when there is no shipping method", () => {
    render(<DeliveryCell name={undefined} />)
    expect(screen.getByText("-")).toBeTruthy()
  })
})
