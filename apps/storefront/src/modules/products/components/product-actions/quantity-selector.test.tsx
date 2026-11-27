// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import QuantitySelector from "./quantity-selector"

afterEach(cleanup)

const setup = (value: number, max: number | null) => {
  const onChange = vi.fn()
  const Harness = () => {
    const [v, setV] = useState(value)
    return (
      <QuantitySelector
        value={v}
        max={max}
        onChange={(n) => {
          onChange(n)
          setV(n)
        }}
      />
    )
  }
  render(<Harness />)
  const byName = (n: string) =>
    document.querySelector(`button[aria-label="${n}"]`) as HTMLButtonElement
  return {
    onChange,
    dec: byName("Decrease quantity"),
    inc: byName("Increase quantity"),
    input: document.querySelector("input") as HTMLInputElement,
  }
}

describe("QuantitySelector", () => {
  it("increments and decrements", async () => {
    const { onChange, dec, inc } = setup(2, null)
    await act(async () => {
      await userEvent.click(inc)
    })
    expect(onChange).toHaveBeenLastCalledWith(3)
    await act(async () => {
      await userEvent.click(dec)
    })
    expect(onChange).toHaveBeenLastCalledWith(2)
  })
  it("disables decrease at 1", () => {
    expect(setup(1, null).dec.disabled).toBe(true)
  })
  it("disables increase at 10", () => {
    expect(setup(10, null).inc.disabled).toBe(true)
  })
  it("disables increase at max 3", () => {
    const { inc } = setup(3, 3)
    expect(inc.disabled).toBe(true)
  })
  it("clamps typed values to the allowed range", async () => {
    const { onChange, input } = setup(1, 3)
    await act(async () => {
      await userEvent.clear(input)
      await userEvent.type(input, "9")
    })
    expect(onChange).toHaveBeenLastCalledWith(3)
  })
  it("clamps 0 up to 1 and ignores non-numeric text", async () => {
    const { onChange, input } = setup(2, null)
    await act(async () => {
      await userEvent.clear(input)
      await userEvent.type(input, "0")
    })
    expect(onChange).toHaveBeenLastCalledWith(1)
    onChange.mockClear()
    await act(async () => {
      await userEvent.type(input, "abc")
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
