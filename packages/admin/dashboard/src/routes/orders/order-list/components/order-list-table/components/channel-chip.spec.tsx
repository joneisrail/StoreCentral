// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { getChannelColor } from "../../channel-color"
import { ChannelChip } from "./channel-chip"

afterEach(cleanup)

describe("ChannelChip", () => {
  it("shows the channel name with a stable colour", () => {
    const { unmount } = render(<ChannelChip name="Amazon" />)
    const first = screen.getByText("Amazon")
    expect(first.className).toContain(
      getChannelColor("Amazon") === "grey"
        ? "neutral"
        : getChannelColor("Amazon")
    )
    const firstClass = first.className
    unmount()

    render(<ChannelChip name="Amazon" />)
    expect(screen.getByText("Amazon").className).toBe(firstClass)
  })

  it("renders a dash when there is no channel", () => {
    render(<ChannelChip name={null} />)
    expect(screen.getByText("-")).toBeTruthy()
  })
})
